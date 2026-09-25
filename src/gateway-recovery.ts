import { GatewayRequestError, type GatewayFailure } from "./gateway-failure.js";

export interface GatewayWait {
  source: "builder" | "planner";
  packetId: string;
  retry: number;
  delayMs: number;
  failure: GatewayFailure;
  reason?: string;
}

export class GatewayUnavailableError extends GatewayRequestError {}

/**
 * One recovery window shared by Builder and Planner, scoped to a pipeline run.
 *
 * Retryable transport failures are retried with capped exponential backoff for
 * as long as the caller's own window (`remainingMs`) lasts; when the window is
 * spent the last failed response is returned as a `GatewayRequestError` so the
 * caller can retry the same work with a fresh window. Waiting never disables
 * later calls. Only Builder authentication failures stop the run, because
 * rejected credentials cannot recover by waiting.
 */
export class GatewayRecovery {
  private blockedUntil = 0;
  private failures = 0;
  private version = 0;
  private stopped?: GatewayUnavailableError;
  private plannerTail: Promise<void> = Promise.resolve();
  private recorder?: (event: GatewayWait) => Promise<void>;
  private lastFailure?: GatewayFailure;
  private lastReason?: string;

  constructor(private readonly time = {
    now: () => Date.now(),
    sleep: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
  }) {}

  get exhausted(): boolean { return this.stopped !== undefined; }
  setRecorder(recorder: (event: GatewayWait) => Promise<void>): void { this.recorder = recorder; }

  async run<T>(source: GatewayWait["source"], packetId: string, remainingMs: () => number,
    operation: () => Promise<T>): Promise<T> {
    // Keep a single planner attempt stream alongside Builder, rather than
    // bursting one model request per atomic requirement at every group start.
    let release: (() => void) | undefined;
    if (source === "planner") {
      const before = this.plannerTail;
      this.plannerTail = new Promise<void>(resolve => { release = resolve; });
      await before;
    }
    try {
      for (let retry = 0; ; retry++) {
        if (this.stopped) throw this.stopped;
        while (this.blockedUntil > this.time.now()) {
          // Waiting never outlives the caller's window: a fresh window is the
          // caller's decision.
          const delayMs = Math.min(this.blockedUntil - this.time.now(), remainingMs());
          if (delayMs <= 0) throw this.gatewayError();
          await this.recorder?.({ source, packetId, retry, delayMs, failure: this.lastFailure!,
            ...(this.lastReason ? { reason: this.lastReason } : {}) });
          await this.time.sleep(Math.min(delayMs, 30_000));
          if (this.stopped) throw this.stopped;
        }
        if (remainingMs() <= 0) throw this.gatewayError();
        const version = this.version;
        try {
          const result = await operation();
          // An already-running success must not erase a newer 429 cooldown.
          if (version === this.version) this.failures = 0;
          return result;
        } catch (error) {
          const failure = error instanceof GatewayRequestError ? error.gatewayFailure
            : (error as { gatewayFailure?: GatewayFailure } | null)?.gatewayFailure;
          if (!failure || error instanceof GatewayUnavailableError) throw error;
          if (!failure.retryable) {
            // A Planner-specific rejection must not disable a working Builder.
            if (failure.kind === "authentication" && source === "builder") this.stopped = new GatewayUnavailableError(failure, { cause: error });
            throw error;
          }
          if (this.lastFailure?.kind !== failure.kind) this.failures = 0;
          this.lastFailure = failure;
          this.lastReason = source === "planner" ? transportCause(error) : undefined;
          const delay = Math.max(failure.retryAfterMs ?? 0, backoffDelay(failure.kind, this.failures));
          this.failures++;
          this.version++;
          this.blockedUntil = Math.max(this.blockedUntil, this.time.now() + delay);
        }
      }
    } finally { release?.(); }
  }

  private gatewayError(): GatewayRequestError {
    return new GatewayRequestError(this.lastFailure ?? { kind: "unavailable", retryable: true });
  }
}

/** Retry-After can extend either schedule. */
function backoffDelay(kind: GatewayFailure["kind"], failures: number): number {
  const [base, cap] = kind === "rate_limit" ? [30_000, 300_000] : [5_000, 60_000];
  return Math.min(base * 2 ** failures, cap);
}

function transportCause(error: unknown): string | undefined {
  let cause = error instanceof Error ? error.cause : undefined;
  const parts: string[] = [];
  for (let depth = 0; depth < 3 && cause !== undefined; depth++) {
    if (cause instanceof Error) {
      const code = (cause as Error & { code?: unknown }).code;
      parts.push(`${cause.name}: ${cause.message}${typeof code === "string" ? ` [${code}]` : ""}`);
      cause = cause.cause;
    } else {
      if (typeof cause === "string") parts.push(cause);
      break;
    }
  }
  return parts.length ? parts.join(" → ") : undefined;
}

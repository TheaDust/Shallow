import type { BuilderPromptInput } from "./prompt-input.js";
import type { ExecutionTiming, ExecutionUsage } from "./pi-execution-stats.js";
import type { GatewayFailure } from "../gateway-failure.js";

export type BuilderRequest = BuilderPromptInput;

export interface BuilderResult {
  sessionId: string;
  outcome: "completed" | "failed" | "timed_out";
  summary: string;
  gatewayFailure?: GatewayFailure;
  execution?: { engine: string; version: string; nodeVersion: string; workerPid: number; resumed: boolean;
    durationMs: number; cleanupMs: number; toolCalls?: number; compactions?: number; peakRssBytes?: number;
    usage: ExecutionUsage; timing?: ExecutionTiming };
  referenceImages?: {
    mode: "attached" | "text_fallback" | "unavailable";
    attachedCount: number;
    skipped: Array<{ reference: string; reason: string }>;
  };
}

export interface BuilderRunOptions {
  timeoutMs?: number;
  /** Controller-owned conversation key; omitted for isolated repair calls. */
  sessionKey?: string;
}

export interface BuilderPort {
  run(request: BuilderRequest, options?: BuilderRunOptions): Promise<BuilderResult>;
  close(): Promise<void>;
}

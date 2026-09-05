import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  RequirementStatus,
  RunEvent,
  ShadowReport,
} from "./types.js";

export type Decision =
  | { kind: "accept" }
  | {
      kind: "repair";
      nextAttempt: 2 | 3;
      requireRootCauseFirst: boolean;
    }
  | { kind: "block_and_restore" };

export interface RunStateSnapshot {
  statusByRequirementId: Record<string, RequirementStatus>;
  attemptsByPacketId: Record<string, number>;
  acceptedSha: string;
  startedAtMs: number;
  totalBudgetMs: number;
  deliveryMode: boolean;
  ledger: RunEvent[];
}

export interface InitialRunState {
  statusByRequirementId: Record<string, RequirementStatus>;
  acceptedSha: string;
  startedAtMs: number;
  totalBudgetMs: number;
}

export interface LogSink {
  write(chunk: string): void;
}

export function decideAfterReport(
  report: ShadowReport,
  attempt: 1 | 2 | 3,
): Decision {
  if (report.verdict === "pass") return { kind: "accept" };
  if (attempt === 1) {
    return { kind: "repair", nextAttempt: 2, requireRootCauseFirst: false };
  }
  if (attempt === 2) {
    return { kind: "repair", nextAttempt: 3, requireRootCauseFirst: true };
  }
  return { kind: "block_and_restore" };
}

export class RunStateStore {
  private readonly state: RunStateSnapshot;

  constructor(
    initial: InitialRunState,
    private readonly ledgerFile?: string,
    private readonly logSink?: LogSink | null,
  ) {
    this.state = {
      ...initial,
      statusByRequirementId: { ...initial.statusByRequirementId },
      attemptsByPacketId: {},
      deliveryMode: false,
      ledger: [],
    };
  }

  get snapshot(): RunStateSnapshot {
    return {
      ...this.state,
      statusByRequirementId: { ...this.state.statusByRequirementId },
      attemptsByPacketId: { ...this.state.attemptsByPacketId },
      ledger: [...this.state.ledger],
    };
  }

  shouldEnterDelivery(nowMs: number): boolean {
    if (this.state.deliveryMode) return true;
    if (this.state.totalBudgetMs <= 0) return false;
    const elapsed = Math.max(0, nowMs - this.state.startedAtMs);
    if (elapsed >= this.state.totalBudgetMs) {
      this.state.deliveryMode = true;
    }
    return this.state.deliveryMode;
  }

  markRequirements(ids: string[], status: RequirementStatus): void {
    for (const id of ids) {
      if (!(id in this.state.statusByRequirementId)) {
        throw new Error(`Unknown requirement status key: ${id}`);
      }
      this.state.statusByRequirementId[id] = status;
    }
  }

  setAcceptedSha(sha: string): void {
    this.state.acceptedSha = sha;
  }

  setPacketAttempt(packetId: string, attempt: number): void {
    this.state.attemptsByPacketId[packetId] = attempt;
  }

  async record(event: RunEvent): Promise<void> {
    const safeEvent = redactEvent(event);
    this.state.ledger.push(safeEvent);
    try {
      this.logSink?.write(`${JSON.stringify(safeEvent)}\n`);
    } catch {
      // Diagnostic sink failures must never change the decision path.
    }
    if (!this.ledgerFile) return;
    try {
      await mkdir(dirname(this.ledgerFile), { recursive: true });
      await appendFile(this.ledgerFile, `${JSON.stringify(safeEvent)}\n`, "utf8");
    } catch {
      // Ledger file failures must never change the decision path.
    }
  }
}

const DIAGNOSTIC_TEXT_LIMIT = 1_500;

export function sanitizeDiagnosticText(text: string): string {
  const normalized = text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t]{2,}/g, " ");
  return normalized.length > DIAGNOSTIC_TEXT_LIMIT
    ? normalized.slice(0, DIAGNOSTIC_TEXT_LIMIT)
    : normalized;
}

function redactEvent(event: RunEvent): RunEvent {
  return JSON.parse(JSON.stringify(event, (key, value: unknown) => {
    if (/key|token|password|secret|cookie/i.test(key)) return "[redacted]";
    if (typeof value === "string" && value.length > 1_500) {
      return `${value.slice(0, 1_500)}…`;
    }
    return value;
  })) as RunEvent;
}

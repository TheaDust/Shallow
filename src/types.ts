import type { ProbeLocator, ProbePlan } from "./judge/probe-schema.js";

export type RequirementStatus = "todo" | "verified" | "blocked";

export type ProductKind =
  | "repository_collaboration"
  | "spreadsheet"
  | "generic_web";

export interface SeedDataCategory {
  category: string;
  items: string[];
}

export interface ProductContext {
  kind: ProductKind;
  rootId: string;
  rootName: string;
  description: string;
  seedData: SeedDataCategory[];
}

export interface RequirementAncestor {
  id: string;
  name: string;
  description: string;
}

export interface AtomicRequirement {
  id: string;
  folderPath: string[];
  declarationIndex: number;
  name: string;
  text: string;
  dependencyIds: string[];
  scenarios: string[];
  references: string[];
  exactUiStrings: string[];
  product: ProductContext;
  ancestors: RequirementAncestor[];
}

export interface RequirementCatalog {
  requirements: AtomicRequirement[];
  statusById: Record<string, RequirementStatus>;
}

/** Original hierarchy for platform projection; scheduling uses expanded atomics. */
export interface RequirementNode {
  id: string;
  name: string;
  type: "ROOT" | "FOLDER" | "ATOMIC";
  description: string;
  dependencies: string[];
  children: RequirementNode[];
  visual_reference: string[];
  scenarios: Array<{ id: string; name: string; steps: Array<{ keyword: string; content: string }> }>;
}

export interface WorkPacket {
  id: string;
  requirementIds: string[];
  requirements: AtomicRequirement[];
  attempt: 1 | 2 | 3;
}

export interface ProcessCommand {
  executable: string;
  args: string[];
  cwd: "output" | "frontend" | "backend";
}

export interface PlatformContract {
  /** Controller-owned runtime data, outside the frozen application tree. */
  dataDirectory?: string;
  baseUrl: string;
  port: number;
  installCommands: ProcessCommand[];
  buildCommands: ProcessCommand[];
  startCommand: ProcessCommand;
  healthPath: string;
  buildTimeoutMs: number;
  startTimeoutMs: number;
}

interface RunEventEnvelope {
  at: string;
  packetId?: string;
  runId?: string;
  eventId?: string;
  sequence?: number;
  elapsedMs?: number;
  phase?: "pipeline" | "builder" | "planner" | "application" | "probe" | "decision" | "delivery" | "projection" | "evidence";
  acceptedSha?: string;
  attempt?: number;
}

type DiagnosticDetail = { message?: string; source?: string; category?: string; code?: string;
  validationError?: string; contentPreview?: string; retryable?: boolean; fatal?: boolean;
  httpStatus?: number; attempt?: number; retryCount?: number; retry?: boolean };

interface RunEventDetails {
  pipeline_started: { requirements?: number; totalBudgetMs?: number; port?: number; model?: string;
    builderTimeoutMs?: number; plannerTimeoutMs?: number; promptSha256?: string; probeSchemaSha256?: string;
    usage?: { status: "unavailable" } };
  packet_selected: { requirementIds?: string[]; names?: string[] };
  builder_started: { attempt?: number; mode?: string };
  builder_finished: { outcome?: "completed" | "failed" | "timed_out"; sessionId?: string; summary?: string;
    attempt?: number; durationMs?: number };
  builder_reference_images: { mode: string; attachedCount: number; skipped: Array<{ reference: string; reason: string }> };
  candidate_prepared: Omit<CandidateEvidence, "runtimeId"> & { reused: boolean; installed: boolean;
    durationMs: number; installMs: number; buildMs: number };
  candidate_prepare_failed: { stage: string; message: string; durationMs: number };
  probe_planning: Record<string, never>;
  probe_planned: { cases: number };
  probe_started: { cases: number; retryCount: number; plan?: ProbePlan; planSha256?: string };
  probe_finished: { verdict: ShadowReport["verdict"]; refined?: boolean; passed?: number; failed?: number;
    durationMs?: number; categories?: ProbeFailure["category"][]; evidenceId?: string; candidate?: CandidateEvidence };
  probe_refined: { plan?: ProbePlan; refinementAttempt?: number; beforePlanSha256?: string; planSha256?: string };
  probe_refinement_failed: DiagnosticDetail & { refinementAttempt?: number; planSha256?: string };
  probe_planner_retry: DiagnosticDetail;
  probe_planner_failed: DiagnosticDetail;
  application_starting: Record<string, never>;
  application_ready: { baseUrl: string; candidate?: CandidateEvidence };
  application_start_failed: DiagnosticDetail;
  application_stopped: Record<string, never>;
  execution_fault: DiagnosticDetail;
  repair_scheduled: { nextAttempt: number; rootCauseFirst: boolean; verdict: ShadowReport["verdict"]; failures: ProbeFailure["category"][] };
  packet_accepted: { candidate?: CandidateEvidence };
  packet_blocked: { reason: string };
  delivery_started: Record<string, never>;
  delivery_repair_started: { stage: string; message: string; round?: number };
  delivery_repair_accepted: { candidate?: CandidateEvidence };
  delivery_repair_restored: { round?: number };
  delivery_finished: { ok: boolean; stage: string; message: string };
  verification_started: { retryCount: number };
  verification_finished: { ok: boolean; stage: string; message: string; durationMs: number; retryCount: number; candidate?: CandidateEvidence };
  pipeline_finished: { status: "delivered" | "partial" | "failed"; verifiedRequirementIds: string[];
    blockedRequirementIds: string[]; pendingRequirementIds: string[]; acceptedSha: string };
  pipeline_failed: DiagnosticDetail;
  arc_projection_failed: DiagnosticDetail;
  evidence_write_failed: Record<string, never>;
}

export type RunEvent = RunEventEnvelope & {
  [Type in keyof RunEventDetails]: { type: Type; detail?: RunEventDetails[Type] }
}[keyof RunEventDetails];

export interface ProbeFailure {
  caseId: string;
  stepIndex: number;
  category: "assertion" | "locator" | "navigation" | "timeout" | "runner";
  message: string;
  locatorSnapshot?: string;
  locatorAttempts?: Array<{ locator: ProbeLocator; message: string }>;
}

export interface ShadowReport {
  candidate?: CandidateEvidence;
  packetId: string;
  verdict: "pass" | "fail" | "inconclusive";
  passedCases: string[];
  failures: ProbeFailure[];
}

export interface CandidateEvidence {
  candidateId: string;
  inputDigest: string;
  applicationDigest: string;
  buildId: string;
  runtimeId: string;
}

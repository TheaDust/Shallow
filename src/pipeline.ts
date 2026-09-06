import type {
  BuilderPort,
  BuilderRequest,
  BuilderResult,
} from "./builder/port.js";
import type {
  BuilderProjectContext,
} from "./builder/prompt-input.js";
import { toBuilderShadowObservation } from "./builder/shadow-observation.js";
import {
  buildArcRequirementRows,
  type ArcRequirementRow,
  type ArcScenarioRow,
} from "./arc-protocol.js";
import { loadRequirementCatalog } from "./catalog.js";
import type { GitOps } from "./git-ops.js";
import type {
  FinalVerificationReport,
  FinalVerifierPort,
} from "./final-verifier.js";
import { ProbePlannerError, type ProbePlanner, type ProbePlannerFeedback } from "./judge/llm-probe-planner.js";
import type { PlaywrightProbeRunner } from "./judge/playwright-probe-runner.js";
import { parseProbePlan, type ProbePlan } from "./judge/probe-schema.js";
import { RunStateStore, decideAfterReport, sanitizeDiagnosticText, type LogSink } from "./run-state.js";
import { selectNextPacket } from "./scheduler.js";
import { ExecutionFault } from "./execution-fault.js";
import type {
  PlatformContract,
  RequirementCatalog,
  ShadowReport,
  WorkPacket,
} from "./types.js";

export interface AppLifecycle {
  start(
    outputDir: string,
    contract: PlatformContract,
  ): Promise<{ baseUrl: string; stop(): Promise<void> }>;
}

export interface Clock {
  nowMs(): number;
}

export interface ArcEventsPort {
  runnerState(
    state: "running" | "completed" | "failed",
    message?: string,
  ): Promise<void>;
  requirementState(
    reqId: string,
    phase: "design" | "implement" | "test",
    status: "running" | "completed" | "failed" | "passed",
  ): Promise<void>;
  commitHistorySignal(reason: string): Promise<void>;
  storeRequirementTree(
    requirementRows: Record<string, ArcRequirementRow>,
    scenarioRows: Record<string, ArcScenarioRow>,
  ): Promise<void>;
  builderDiagnostic(
    packetId: string,
    outcome: BuilderResult["outcome"],
    summary: string,
  ): Promise<void>;
}

export interface PipelineDeps {
  builder: BuilderPort;
  planner: ProbePlanner;
  runner: Pick<PlaywrightProbeRunner, "run">;
  git: GitOps;
  appLifecycle: AppLifecycle;
  clock: Clock;
  finalVerifier: FinalVerifierPort;
  arcEvents?: ArcEventsPort;
  logSink?: LogSink;
}

export interface PipelineOptions {
  requirementsFile: string;
  outputDir: string;
  ledgerFile: string;
  totalBudgetMs: number;
  platformContract: PlatformContract;
  plannerRetryDelayMs?: number;
}

export interface RunSummary {
  status: "delivered" | "partial" | "failed";
  verifiedRequirementIds: string[];
  blockedRequirementIds: string[];
  acceptedSha: string;
}

export async function runPipeline(
  options: PipelineOptions,
  deps: PipelineDeps,
): Promise<RunSummary> {
  let builderClosed = false;
  const closeBuilder = async () => {
    if (builderClosed) return;
    builderClosed = true;
    await deps.builder.close();
  };
  const catalog = await loadRequirementCatalog(options.requirementsFile);
  const baselineSha = await deps.git.captureAccepted("shallow: initial state");
  const state = new RunStateStore(
    {
      statusByRequirementId: catalog.statusById,
      acceptedSha: baselineSha,
      startedAtMs: deps.clock.nowMs(),
      totalBudgetMs: options.totalBudgetMs,
    },
    options.ledgerFile,
    deps.logSink ?? null,
  );

  await state.record({ at: now(), type: "pipeline_started" });
  await emitArc(deps, (arc) => arc.runnerState("running", "pipeline started"));
  const arcRows = buildArcRequirementRows(catalog.requirements);
  await emitArc(deps, (arc) =>
    arc.storeRequirementTree(arcRows.requirementRows, arcRows.scenarioRows),
  );
  try {
    while (!state.shouldEnterDelivery(deps.clock.nowMs())) {
      const packet = selectNextPacket(catalog);
      if (!packet) break;
      await state.record({ at: now(), type: "packet_selected", packetId: packet.id });
      await executePacket(packet, options, deps, state, catalog);
    }

    await state.record({ at: now(), type: "delivery_started" });
    let finalReport = await runFinalVerifier(options, deps, state);
    if (!finalReport.ok) {
      await state.record({
        at: now(),
        type: "delivery_repair_started",
        detail: { stage: finalReport.stage, message: finalReport.message },
      });
      await state.record({
        at: now(),
        type: "builder_started",
        packetId: "delivery-repair",
      });
      let builderResult: BuilderResult;
      try {
        builderResult = await deps.builder.run({
          mode: "delivery_repair",
          outputDir: options.outputDir,
          platformContract: options.platformContract,
          deliveryFailure: {
            stage: finalReport.stage,
            expected: expectedByStage[finalReport.stage],
            actual: finalReport.message,
          },
        });
      } catch (error) {
        if (error instanceof ExecutionFault) throw error;
        builderResult = {
          sessionId: "unavailable",
          outcome: "failed",
          summary: errorMessage(error),
        };
      }
      state.setPacketAttempt("delivery-repair", 3);
      await state.record({
        at: now(),
        type: "builder_finished",
        packetId: "delivery-repair",
        detail: {
          outcome: builderResult.outcome,
          sessionId: builderResult.sessionId,
          summary: sanitizeDiagnosticText(builderResult.summary),
        },
      });
      await emitArc(deps, (arc) =>
        arc.builderDiagnostic(
          "delivery-repair",
          builderResult.outcome,
          builderResult.summary,
        ),
      );
      finalReport = await runFinalVerifier(options, deps, state);
      if (finalReport.ok && builderResult.outcome === "completed") {
        const acceptedSha = await deps.git.captureAccepted(
          "shallow: accept delivery repair",
        );
        state.setAcceptedSha(acceptedSha);
        await state.record({
          at: now(),
          type: "delivery_repair_accepted",
          packetId: "delivery-repair",
        });
        await emitArc(deps, (arc) => arc.commitHistorySignal("git_commit"));
      } else {
        await deps.git.restoreAccepted(state.snapshot.acceptedSha);
        if (finalReport.ok) {
          finalReport = {
            ok: false,
            stage: "complete",
            message: `Delivery repair was not completed (${builderResult.outcome}); restored accepted state`,
          };
        }
        await state.record({ at: now(), type: "delivery_repair_restored" });
      }
    }
    await state.record({
      at: now(),
      type: "delivery_finished",
      detail: {
        ok: finalReport.ok,
        stage: finalReport.stage,
        message: finalReport.message,
      },
    });

    const snapshot = state.snapshot;
    const verifiedRequirementIds = idsWithStatus(snapshot.statusByRequirementId, "verified");
    const blockedRequirementIds = idsWithStatus(snapshot.statusByRequirementId, "blocked");
    const summary: RunSummary = {
      status: finalReport.ok
        ? verifiedRequirementIds.length < catalog.requirements.length
          ? "partial"
          : "delivered"
        : "failed",
      verifiedRequirementIds,
      blockedRequirementIds,
      acceptedSha: snapshot.acceptedSha,
    };
    await emitArc(deps, (arc) =>
      arc.runnerState(
        finalReport.ok ? "completed" : "failed",
        `summary ${summary.status}`,
      ),
    );
    await state.record({ at: now(), type: "pipeline_finished", detail: {
      ...summary,
      pendingRequirementIds: Object.entries(snapshot.statusByRequirementId)
        .filter(([, status]) => status === "todo").map(([id]) => id),
    } });
    return summary;
  } catch (error) {
    // Unexpected runner/process failures must not leave an unaccepted candidate.
    try {
      await closeBuilder();
    } finally {
      await deps.git.restoreAccepted(state.snapshot.acceptedSha);
    }
    await state.record({ at: now(), type: "pipeline_failed", detail: error instanceof ExecutionFault
      ? { message: error.message, source: error.source, code: error.code, retryable: error.retryable }
      : plannerFailureDetail(error) });
    await emitArc(deps, (arc) => arc.runnerState("failed", "pipeline failed"));
    throw error;
  } finally {
    await closeBuilder();
  }
}

async function executePacket(
  selected: WorkPacket,
  options: PipelineOptions,
  deps: PipelineDeps,
  state: RunStateStore,
  catalog: RequirementCatalog,
): Promise<void> {
  const catalogStatus = catalog.statusById;
  let attempt: 1 | 2 | 3 = 1;
  let previousReport: ShadowReport | undefined;
  let plan: ProbePlan | undefined;
  let refinementUsed = false;
  let iteration = 0;
  const infrastructure = { browserRetries: 0 };

  while (true) {
    iteration += 1;
    if (iteration > MAX_PACKET_ITERATIONS) {
      await blockPacket(
        deps,
        state,
        { ...selected, attempt },
        catalogStatus,
        "packet iteration cap exceeded",
      );
      return;
    }

    const packet: WorkPacket = { ...selected, attempt };
    if (state.shouldEnterDelivery(deps.clock.nowMs())) {
      await blockPacket(deps, state, packet, catalogStatus, "packet budget exhausted");
      return;
    }
    state.setPacketAttempt(packet.id, attempt);
    for (const requirementId of packet.requirementIds) {
      await emitArc(deps, (arc) =>
        arc.requirementState(requirementId, "implement", "running"),
      );
    }

    const mode = packetBuilderMode(attempt);
    let builderRequest: BuilderRequest;
    if (mode === "implement") {
      builderRequest = {
        mode,
        packet,
        projectContext: buildBuilderProjectContext(packet, catalog),
        outputDir: options.outputDir,
        platformContract: options.platformContract,
      };
    } else {
      if (!previousReport) {
        throw new Error(`Packet ${packet.id} entered ${mode} without a shadow report`);
      }
      builderRequest = {
        mode,
        packet,
        projectContext: buildBuilderProjectContext(packet, catalog),
        shadowObservation: toBuilderShadowObservation(previousReport),
        outputDir: options.outputDir,
        platformContract: options.platformContract,
      };
    }

    await state.record({ at: now(), type: "builder_started", packetId: packet.id, detail: { attempt } });
    let builderResult: BuilderResult;
    try {
      builderResult = await deps.builder.run(builderRequest);
    } catch (error) {
      if (error instanceof ExecutionFault) throw error;
      builderResult = {
        sessionId: "unavailable",
        outcome: "failed",
        summary: errorMessage(error),
      };
    }
    await state.record({
      at: now(),
      type: "builder_finished",
      packetId: packet.id,
      detail: {
        outcome: builderResult.outcome,
        sessionId: builderResult.sessionId,
        summary: sanitizeDiagnosticText(builderResult.summary),
        attempt,
      },
    });
    await emitArc(deps, (arc) =>
      arc.builderDiagnostic(packet.id, builderResult.outcome, builderResult.summary),
    );
    if (builderResult.referenceImages) {
      await state.record({
        at: now(), type: "builder_reference_images", packetId: packet.id,
        detail: builderResult.referenceImages,
      });
    }

    let report: ShadowReport;
    if (builderResult.outcome !== "completed") {
      report = builderFailureReport(packet.id, builderResult.summary);
    } else {
      if (!plan) {
        plan = await planProbe(packet, options, deps, state);
        if (!plan) {
          await blockPacket(deps, state, packet, catalogStatus, "probe planner failed");
          return;
        }
        await state.record({
          at: now(),
          type: "probe_planned",
          packetId: packet.id,
          detail: { cases: plan.cases.length },
        });
      }
      let probeOutcome: ProbeOutcome;
      try {
        probeOutcome = await runShadowProbes(packet, plan, options, deps, state, refinementUsed, infrastructure);
      } catch (error) {
        if (!(error instanceof ExecutionFault) || !error.retryable) throw error;
        await blockPacket(deps, state, packet, catalogStatus, "browser infrastructure retries exhausted or budget exhausted");
        return;
      }
      plan = probeOutcome.plan;
      refinementUsed = probeOutcome.refinementUsed;
      report = probeOutcome.report;
      if (probeOutcome.source === "probe" && report.verdict !== "pass" &&
        report.failures.every((failure) => failure.category === "locator" || failure.category === "runner")) {
        await blockPacket(deps, state, packet, catalogStatus, "judge could not establish valid behavior evidence");
        return;
      }
    }

    const decision = decideAfterReport(report, attempt);
    if (decision.kind === "accept") {
      const acceptedSha = await deps.git.captureAccepted(`shallow: accept ${packet.id}`);
      state.setAcceptedSha(acceptedSha);
      state.markRequirements(packet.requirementIds, "verified");
      setCatalogStatus(catalogStatus, packet.requirementIds, "verified");
      await state.record({ at: now(), type: "packet_accepted", packetId: packet.id });
      for (const requirementId of packet.requirementIds) {
        await emitArc(deps, (arc) =>
          arc.requirementState(requirementId, "implement", "completed"),
        );
        await emitArc(deps, (arc) =>
          arc.requirementState(requirementId, "test", "passed"),
        );
      }
      await emitArc(deps, (arc) => arc.commitHistorySignal("git_commit"));
      return;
    }
    if (decision.kind === "repair") {
      previousReport = report;
      attempt = decision.nextAttempt;
      continue;
    }

    await blockPacket(deps, state, packet, catalogStatus, "shadow attempts exhausted");
    return;
  }
}

interface ProbeOutcome {
  source: "application" | "probe";
  report: ShadowReport;
  plan: ProbePlan;
  refinementUsed: boolean;
}

function packetBuilderMode(attempt: 1 | 2 | 3): "implement" | "repair" | "root_cause_repair" {
  if (attempt === 1) return "implement";
  return attempt === 2 ? "repair" : "root_cause_repair";
}

function buildBuilderProjectContext(
  packet: WorkPacket,
  catalog: RequirementCatalog,
): BuilderProjectContext {
  const first = packet.requirements[0];
  if (!first) throw new Error(`Packet ${packet.id} has no requirements`);
  const dependencyIds = new Set(
    packet.requirements.flatMap((item) => item.dependencyIds),
  );
  return {
    product: first.product,
    ancestors: dedupeAncestors(
      packet.requirements.flatMap((item) => item.ancestors),
    ),
    satisfiedDependencies: catalog.requirements
      .filter((item) => dependencyIds.has(item.id))
      .map((item) => ({ id: item.id, name: item.name, contract: item.text })),
  };
}

function dedupeAncestors(
  ancestors: WorkPacket["requirements"][number]["ancestors"],
): WorkPacket["requirements"][number]["ancestors"] {
  const seen = new Set<string>();
  const unique: WorkPacket["requirements"][number]["ancestors"] = [];
  for (const ancestor of ancestors) {
    if (seen.has(ancestor.id)) continue;
    seen.add(ancestor.id);
    unique.push(ancestor);
  }
  return unique;
}

const expectedByStage = {
  install: "平台安装命令成功退出",
  build: "平台构建命令成功退出并生成生产构建产物",
  readiness: "应用使用随机端口启动且健康检查返回成功",
  browser: "根页面可访问并显示主要内容区域",
  complete: "完整交付验证成功",
} satisfies Record<FinalVerificationReport["stage"], string>;

async function runShadowProbes(
  packet: WorkPacket,
  plan: ProbePlan,
  options: PipelineOptions,
  deps: PipelineDeps,
  state: RunStateStore,
  refinementUsed: boolean,
  infrastructure: { browserRetries: number },
): Promise<ProbeOutcome> {
  let application: Awaited<ReturnType<AppLifecycle["start"]>>;
  try {
    application = await deps.appLifecycle.start(
      options.outputDir,
      options.platformContract,
    );
  } catch (error) {
    await state.record({
      at: now(),
      type: "application_start_failed",
      packetId: packet.id,
      detail: { message: errorMessage(error) },
    });
    return { source: "application", report: applicationFailureReport(packet.id, error), plan, refinementUsed };
  }

  try {
    let currentPlan = plan;
    let used = refinementUsed;
    const runOptions = { stepTimeoutMs: 2_000, caseTimeoutMs: 15_000 };
    const run = async (): Promise<ShadowReport> => {
      while (true) {
        try {
          return await deps.runner.run(currentPlan, { baseUrl: application.baseUrl, ...runOptions });
        } catch (error) {
          if (!(error instanceof ExecutionFault)) throw error;
          const retry = error.retryable && infrastructure.browserRetries < 1 &&
            !state.shouldEnterDelivery(deps.clock.nowMs());
          await state.record({ at: now(), type: "execution_fault", packetId: packet.id,
            detail: { source: error.source, code: error.code, retryable: error.retryable,
              retry, attempt: packet.attempt, retryCount: infrastructure.browserRetries } });
          if (!retry) throw error;
          infrastructure.browserRetries += 1;
        }
      }
    };
    let report = await run();
    await state.record({
      at: now(),
      type: "probe_finished",
      packetId: packet.id,
      detail: { verdict: report.verdict },
    });

    if (report.verdict === "inconclusive" && !used) {
      const snapshot = report.failures.find(
        (failure) => failure.category === "locator" && failure.locatorSnapshot,
      )?.locatorSnapshot;
      if (snapshot) {
        try {
          currentPlan = await deps.planner.refineLocators(currentPlan, snapshot);
          used = true;
          await state.record({ at: now(), type: "probe_refined", packetId: packet.id });
          report = await run();
          await state.record({
            at: now(),
            type: "probe_finished",
            packetId: packet.id,
            detail: { verdict: report.verdict, refined: true },
          });
        } catch (error) {
          if (error instanceof ExecutionFault || (error instanceof ProbePlannerError && error.fatal)) throw error;
          used = true;
          await state.record({
            at: now(),
            type: "probe_refinement_failed",
            packetId: packet.id,
            detail: plannerFailureDetail(error),
          });
        }
      }
    }
    return { source: "probe", report, plan: currentPlan, refinementUsed: used };
  } finally {
    await application.stop();
  }
}

const MAX_PACKET_ITERATIONS = 6;

async function planProbe(
  packet: WorkPacket,
  options: PipelineOptions,
  deps: PipelineDeps,
  state: RunStateStore,
): Promise<ProbePlan | undefined> {
  let feedback: ProbePlannerFeedback | undefined;
  try {
    return parseProbePlan(await deps.planner.plan(packet), packet);
  } catch (error) {
    if (error instanceof ProbePlannerError && (error.category === "json" || error.category === "schema")) {
      feedback = {
        validationError: error.diagnostics.validationError ?? error.diagnostics.message,
        contentPreview: error.diagnostics.contentPreview,
      };
    }
    await state.record({
      at: now(),
      type: error instanceof ProbePlannerError && error.fatal ? "probe_planner_failed" : "probe_planner_retry",
      packetId: packet.id,
      detail: { ...plannerFailureDetail(error), attempt: packet.attempt, retryCount: 0 },
    });
    if (error instanceof ProbePlannerError && error.fatal) throw error;
  }
  if (state.shouldEnterDelivery(deps.clock.nowMs())) return undefined;
  const retryDelayMs = options.plannerRetryDelayMs ?? 2_000;
  if (retryDelayMs > 0) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, retryDelayMs));
  }
  if (state.shouldEnterDelivery(deps.clock.nowMs())) return undefined;
  try {
    return parseProbePlan(await deps.planner.plan(packet, feedback), packet);
  } catch (error) {
    await state.record({
      at: now(),
      type: "probe_planner_failed",
      packetId: packet.id,
      detail: plannerFailureDetail(error),
    });
    if (error instanceof ProbePlannerError && error.fatal) throw error;
    return undefined;
  }
}

function plannerFailureDetail(error: unknown): Record<string, unknown> {
  return error instanceof ProbePlannerError
    ? { source: "planner", ...error.diagnostics }
    : { message: sanitizeDiagnosticText(errorMessage(error)) };
}

async function blockPacket(
  deps: PipelineDeps,
  state: RunStateStore,
  packet: WorkPacket,
  catalogStatus: Record<string, "todo" | "verified" | "blocked">,
  reason: string,
): Promise<void> {
  await deps.git.restoreAccepted(state.snapshot.acceptedSha);
  state.markRequirements(packet.requirementIds, "blocked");
  setCatalogStatus(catalogStatus, packet.requirementIds, "blocked");
  await state.record({
    at: now(),
    type: "packet_blocked",
    packetId: packet.id,
    detail: { reason },
  });
  for (const requirementId of packet.requirementIds) {
    await emitArc(deps, (arc) =>
      arc.requirementState(requirementId, "implement", "failed"),
    );
  }
}

function applicationFailureReport(packetId: string, error: unknown): ShadowReport {
  return {
    packetId,
    verdict: "fail",
    passedCases: [],
    failures: [
      {
        caseId: "<application>",
        stepIndex: -1,
        category: "runner",
        message: errorMessage(error),
      },
    ],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function emitArc(
  deps: PipelineDeps,
  emit: (arc: ArcEventsPort) => Promise<void> | void,
): Promise<void> {
  if (!deps.arcEvents) return;
  try {
    await emit(deps.arcEvents);
  } catch {
    return;
  }
}

function builderFailureReport(packetId: string, message: string): ShadowReport {
  return {
    packetId,
    verdict: "fail",
    passedCases: [],
    failures: [
      {
        caseId: "<builder>",
        stepIndex: -1,
        category: "runner",
        message,
      },
    ],
  };
}

async function runFinalVerifier(
  options: PipelineOptions,
  deps: PipelineDeps,
  state: RunStateStore,
): Promise<FinalVerificationReport> {
  for (let retryCount = 0; ; retryCount += 1) {
    try {
      return await deps.finalVerifier.verify(options.outputDir, options.platformContract);
    } catch (error) {
      if (error instanceof ExecutionFault) {
        const retry = error.retryable && retryCount < 1;
        await state.record({ at: now(), type: "execution_fault", packetId: "final-verification",
          detail: { source: error.source, code: error.code, retryable: error.retryable, retry, retryCount } });
        if (retry) continue;
        throw error;
      }
      return { ok: false, stage: "readiness", message: errorMessage(error) };
    }
  }
}

function setCatalogStatus(
  statuses: Record<string, "todo" | "verified" | "blocked">,
  ids: string[],
  status: "verified" | "blocked",
): void {
  for (const id of ids) statuses[id] = status;
}

function idsWithStatus(
  statuses: Record<string, "todo" | "verified" | "blocked">,
  status: "verified" | "blocked",
): string[] {
  return Object.entries(statuses)
    .filter(([, value]) => value === status)
    .map(([id]) => id);
}

function now(): string {
  return new Date().toISOString();
}

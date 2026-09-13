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
import { assertLocatorOnlyRefinement, parseProbePlan, probePlanSha256, type ProbePlan } from "./judge/probe-schema.js";
import { RunStateStore, decideAfterReport, sanitizeDiagnosticText, type LogSink } from "./run-state.js";
import { selectNextPacket } from "./scheduler.js";
import { ExecutionFault } from "./execution-fault.js";
import type { CandidateRuntime } from "./candidate-runtime.js";
import type { CandidateEvidence } from "./types.js";
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
  ): Promise<{ baseUrl: string; candidate?: CandidateEvidence; assertUnchanged?(): Promise<void>; stop(): Promise<void> }>;
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
}

export interface PipelineDeps {
  builder: BuilderPort;
  planner: ProbePlanner;
  runner: Pick<PlaywrightProbeRunner, "run">;
  git: GitOps;
  appLifecycle: AppLifecycle;
  candidate?: CandidateRuntime;
  clock: Clock;
  finalVerifier: FinalVerifierPort;
  arcEvents?: ArcEventsPort;
  logSink?: LogSink;
  diagnosticSecrets?: readonly string[];
  runMetadata?: Record<string, unknown>;
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
    deps.diagnosticSecrets,
  );

  deps.candidate?.setRecorder((event) => state.record(event));
  await state.record({ at: now(), type: "pipeline_started", detail: {
    requirements: catalog.requirements.length, totalBudgetMs: options.totalBudgetMs,
    port: options.platformContract.port, ...deps.runMetadata,
  } });
  await emitArc(deps, state, (arc) => arc.runnerState("running", "pipeline started"));
  const arcRows = buildArcRequirementRows(catalog.tree);
  await emitArc(deps, state, (arc) =>
    arc.storeRequirementTree(arcRows.requirementRows, arcRows.scenarioRows),
  );
  try {
    while (!state.shouldEnterDelivery(deps.clock.nowMs())) {
      const packet = selectNextPacket(catalog);
      if (!packet) break;
      await state.record({ at: now(), type: "packet_selected", packetId: packet.id,
        detail: { requirementIds: packet.requirementIds, names: packet.requirements.map((item) => item.name) } });
      await executePacket(packet, options, deps, state, catalog);
    }

    await state.record({ at: now(), type: "delivery_started" });
    await deps.candidate?.assertAcceptedInput();
    let finalReport = await runFinalVerifier(options, deps, state);
    // Keep repairing delivery until it passes. There is no attempt-count cap: the first
    // repair always runs (delivery reserve) and later rounds require remaining budget.
    let deliveryRepairRound = 0;
    while (!finalReport.ok) {
      deliveryRepairRound += 1;
      if (deliveryRepairRound > 1 && !state.withinBudget(deps.clock.nowMs())) break;
      await state.record({
        at: now(),
        type: "delivery_repair_started",
        detail: { stage: finalReport.stage, message: finalReport.message, round: deliveryRepairRound },
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
            actual: sanitizeDiagnosticText(finalReport.message, deps.diagnosticSecrets),
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
          summary: builderResult.summary,
        },
      });
      finalReport = await runFinalVerifier(options, deps, state);
      if (finalReport.ok && builderResult.outcome === "completed") {
        if (finalReport.candidate) await deps.candidate?.assertCurrent(finalReport.candidate);
        const acceptedSha = await deps.git.captureAccepted(
          "shallow: accept delivery repair",
        );
        if (finalReport.candidate) await deps.candidate?.assertCurrent(finalReport.candidate);
        state.setAcceptedSha(acceptedSha);
        if (finalReport.candidate) deps.candidate?.recordAccepted(finalReport.candidate);
        await state.record({
          at: now(),
          type: "delivery_repair_accepted",
          packetId: "delivery-repair",
          ...(finalReport.candidate ? { detail: { candidate: finalReport.candidate } } : {}),
        });
        await emitArc(deps, state, (arc) => arc.commitHistorySignal("git_commit"));
      } else {
        await deps.git.restoreAccepted(state.snapshot.acceptedSha);
        if (finalReport.ok) {
          finalReport = {
            ok: false,
            stage: "complete",
            message: `Delivery repair was not completed (${builderResult.outcome}); restored accepted state`,
          };
        }
        await state.record({ at: now(), type: "delivery_repair_restored", detail: { round: deliveryRepairRound } });
      }
    }
    if (finalReport.ok) {
      if (finalReport.candidate) await deps.candidate?.assertCurrent(finalReport.candidate);
      await deps.candidate?.assertAcceptedInput();
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
    await emitArc(deps, state, (arc) =>
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
    await emitArc(deps, state, (arc) => arc.runnerState("failed", "pipeline failed"));
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
  let iteration = 0;
  const recovery = { browserRetries: 0, locatorRefinements: 0 };

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
      await emitArc(deps, state, (arc) =>
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
        shadowObservation: toBuilderShadowObservation(previousReport, deps.diagnosticSecrets),
        outputDir: options.outputDir,
        platformContract: options.platformContract,
      };
    }

    await state.record({ at: now(), type: "builder_started", packetId: packet.id, detail: { attempt, mode } });
    const builderStartedAt = deps.clock.nowMs();
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
        summary: builderResult.summary,
        attempt,
        durationMs: Math.max(0, deps.clock.nowMs() - builderStartedAt),
      },
    });
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
        probeOutcome = await runShadowProbes(packet, plan, options, deps, state, recovery);
      } catch (error) {
        if (!(error instanceof ExecutionFault) || !error.retryable) throw error;
        await blockPacket(deps, state, packet, catalogStatus, "browser infrastructure retries exhausted or budget exhausted");
        return;
      }
      plan = probeOutcome.plan;
      report = probeOutcome.report;
      if (probeOutcome.source === "probe" && report.verdict !== "pass" &&
        report.failures.every((failure) => failure.category === "locator" || failure.category === "runner")) {
        await blockPacket(deps, state, packet, catalogStatus, "judge could not establish valid behavior evidence");
        return;
      }
    }

    const decision = decideAfterReport(report, attempt);
    if (decision.kind === "accept") {
      if (report.candidate) await deps.candidate?.assertCurrent(report.candidate);
      const acceptedSha = await deps.git.captureAccepted(`shallow: accept ${packet.id}`);
      if (report.candidate) await deps.candidate?.assertCurrent(report.candidate);
      state.setAcceptedSha(acceptedSha);
      if (report.candidate) deps.candidate?.recordAccepted(report.candidate);
      state.markRequirements(packet.requirementIds, "verified");
      setCatalogStatus(catalogStatus, packet.requirementIds, "verified");
      await state.record({ at: now(), type: "packet_accepted", packetId: packet.id,
        ...(report.candidate ? { detail: { candidate: report.candidate } } : {}) });
      for (const requirementId of packet.requirementIds) {
        await emitArc(deps, state, (arc) =>
          arc.requirementState(requirementId, "implement", "completed"),
        );
        await emitArc(deps, state, (arc) =>
          arc.requirementState(requirementId, "test", "passed"),
        );
      }
      await emitArc(deps, state, (arc) => arc.commitHistorySignal("git_commit"));
      return;
    }
    if (decision.kind === "repair") {
      await state.record({ at: now(), type: "repair_scheduled", packetId: packet.id,
        detail: { nextAttempt: decision.nextAttempt, rootCauseFirst: decision.requireRootCauseFirst,
          verdict: report.verdict, failures: report.failures.map((failure) => failure.category) } });
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
  candidate: "验收与接受对应同一份未变化的候选文件和构建产物",
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
  recovery: { browserRetries: number; locatorRefinements: number },
): Promise<ProbeOutcome> {
  await state.record({ at: now(), type: "application_starting", packetId: packet.id });
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
    return { source: "application", report: applicationFailureReport(packet.id, error), plan };
  }

  try {
    await state.record({ at: now(), type: "application_ready", packetId: packet.id,
      detail: { baseUrl: application.baseUrl, ...(application.candidate ? { candidate: application.candidate } : {}) } });
    let currentPlan = plan;
    const runOptions = { stepTimeoutMs: 2_000, caseTimeoutMs: 15_000 };
    const run = async (): Promise<ShadowReport> => {
      while (true) {
        const startedAt = deps.clock.nowMs();
        await state.record({ at: now(), type: "probe_started", packetId: packet.id,
          detail: { cases: currentPlan.cases.length, retryCount: recovery.browserRetries,
            planSha256: probePlanSha256(currentPlan) } });
        try {
          const report = await deps.runner.run(currentPlan, { baseUrl: application.baseUrl, ...runOptions });
          await application.assertUnchanged?.();
          if (application.candidate) report.candidate = application.candidate;
          const evidenceId = await state.saveEvidence(report, currentPlan);
          await state.record({ at: now(), type: "probe_finished", packetId: packet.id,
            detail: { verdict: report.verdict, refined: recovery.locatorRefinements > 0, passed: report.passedCases.length,
              failed: report.failures.length, durationMs: Math.max(0, deps.clock.nowMs() - startedAt),
              categories: report.failures.map((failure) => failure.category), evidenceId,
              ...(report.candidate ? { candidate: report.candidate } : {}) } });
          return report;
        } catch (error) {
          if (!(error instanceof ExecutionFault)) throw error;
          const retry = error.retryable && recovery.browserRetries < 1 &&
            !state.shouldEnterDelivery(deps.clock.nowMs());
          await state.record({ at: now(), type: "execution_fault", packetId: packet.id,
            detail: { source: error.source, code: error.code, retryable: error.retryable,
              retry, attempt: packet.attempt, retryCount: recovery.browserRetries } });
          if (!retry) throw error;
          recovery.browserRetries += 1;
        }
      }
    };
    let report = await run();

    let feedback: ProbePlannerFeedback | undefined;
    while (report.verdict === "inconclusive" &&
      report.failures.length > 0 && report.failures.every((failure) => failure.category === "locator") &&
      report.failures.some((failure) => failure.locatorSnapshot) &&
      recovery.locatorRefinements < MAX_LOCATOR_REFINEMENTS &&
      !state.shouldEnterDelivery(deps.clock.nowMs())) {
      const refinementAttempt = ++recovery.locatorRefinements;
      const beforePlanSha256 = probePlanSha256(currentPlan);
      let refined: ProbePlan;
      try {
        // Pass a copy so a planner implementation cannot mutate the behavior being checked.
        refined = parseProbePlan(await deps.planner.refineLocators(
          structuredClone(currentPlan), structuredClone(report.failures), feedback,
        ));
        assertLocatorOnlyRefinement(currentPlan, refined, report.failures);
      } catch (error) {
        if (error instanceof ExecutionFault || (error instanceof ProbePlannerError && error.fatal)) throw error;
        const detail = plannerFailureDetail(error);
        feedback = {
          validationError: String(detail.validationError ?? detail.message),
          ...(typeof detail.contentPreview === "string" ? { contentPreview: detail.contentPreview } : {}),
        };
        await state.record({ at: now(), type: "probe_refinement_failed", packetId: packet.id,
          detail: { ...detail, refinementAttempt, planSha256: beforePlanSha256 } });
        continue;
      }
      if (state.shouldEnterDelivery(deps.clock.nowMs())) break;
      currentPlan = refined;
      feedback = undefined;
      await state.record({ at: now(), type: "probe_refined", packetId: packet.id,
        detail: { refinementAttempt, beforePlanSha256, planSha256: probePlanSha256(currentPlan) } });
      // Browser failures use their own shared quota, outside the planner error handler.
      report = await run();
    }
    return { source: "probe", report, plan: currentPlan };
  } finally {
    await application.stop();
    await state.record({ at: now(), type: "application_stopped", packetId: packet.id });
  }
}

const MAX_PACKET_ITERATIONS = 6;
const MAX_LOCATOR_REFINEMENTS = 2;

async function planProbe(
  packet: WorkPacket,
  options: PipelineOptions,
  deps: PipelineDeps,
  state: RunStateStore,
): Promise<ProbePlan | undefined> {
  await state.record({ at: now(), type: "probe_planning", packetId: packet.id });
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
    : { message: errorMessage(error) };
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
    await emitArc(deps, state, (arc) =>
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
  state: RunStateStore,
  emit: (arc: ArcEventsPort) => Promise<void> | void,
): Promise<void> {
  if (!deps.arcEvents) return;
  try {
    await emit(deps.arcEvents);
  } catch (error) {
    await state.record({ at: now(), type: "arc_projection_failed", detail: { message: errorMessage(error) } });
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
    const startedAt = deps.clock.nowMs();
    await state.record({ at: now(), type: "verification_started", detail: { retryCount } });
    try {
      const report = await deps.finalVerifier.verify(options.outputDir, options.platformContract);
      await state.record({ at: now(), type: "verification_finished",
        detail: { ...report, durationMs: Math.max(0, deps.clock.nowMs() - startedAt), retryCount } });
      return report;
    } catch (error) {
      if (error instanceof ExecutionFault) {
        // No retry-count cap: keep retrying retryable infrastructure faults while a
        // finite budget allows it. The first retry always runs so delivery is never
        // abandoned when the packet phase already consumed the budget.
        const retry = error.retryable &&
          (retryCount === 0 || state.withinBudget(deps.clock.nowMs()));
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

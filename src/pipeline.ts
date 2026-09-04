import type {
  BuilderPort,
  BuilderResult,
} from "./builder/port.js";
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
import type { ProbePlanner } from "./judge/llm-probe-planner.js";
import type { PlaywrightProbeRunner } from "./judge/playwright-probe-runner.js";
import type { ProbePlan } from "./judge/probe-schema.js";
import { RunStateStore, decideAfterReport, type LogSink } from "./run-state.js";
import { selectNextPacket } from "./scheduler.js";
import type { PlatformContract, ShadowReport, WorkPacket } from "./types.js";

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
      await executePacket(packet, options, deps, state, catalog.statusById);
    }

    await state.record({ at: now(), type: "delivery_started" });
    let finalReport = await runFinalVerifier(options, deps);
    if (!finalReport.ok) {
      await state.record({
        at: now(),
        type: "delivery_repair_started",
        detail: { stage: finalReport.stage, message: finalReport.message },
      });
      let builderResult: BuilderResult;
      try {
        builderResult = await deps.builder.run({
          packet: {
            id: "delivery-repair",
            requirementIds: [],
            requirements: [],
            attempt: 3,
          },
          outputDir: options.outputDir,
          platformContract: options.platformContract,
          shadowReport: deliveryFailureReport(finalReport),
          requireRootCauseFirst: true,
        });
      } catch (error) {
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
        detail: { outcome: builderResult.outcome, sessionId: builderResult.sessionId },
      });
      finalReport = await runFinalVerifier(options, deps);
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
        ? blockedRequirementIds.length > 0
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
    await state.record({ at: now(), type: "pipeline_finished" });
    return summary;
  } finally {
    await deps.builder.close();
  }
}

async function executePacket(
  selected: WorkPacket,
  options: PipelineOptions,
  deps: PipelineDeps,
  state: RunStateStore,
  catalogStatus: Record<string, "todo" | "verified" | "blocked">,
): Promise<void> {
  let attempt: 1 | 2 | 3 = 1;
  let previousReport: ShadowReport | undefined;
  let requireRootCauseFirst = false;
  let plan: ProbePlan | undefined;
  let refinementUsed = false;
  let iteration = 0;

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
    state.setPacketAttempt(packet.id, attempt);
    for (const requirementId of packet.requirementIds) {
      await emitArc(deps, (arc) =>
        arc.requirementState(requirementId, "implement", "running"),
      );
    }

    let builderResult: BuilderResult;
    try {
      builderResult = await deps.builder.run({
        packet,
        outputDir: options.outputDir,
        platformContract: options.platformContract,
        ...(previousReport ? { shadowReport: previousReport } : {}),
        requireRootCauseFirst,
      });
    } catch (error) {
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
      detail: { outcome: builderResult.outcome, sessionId: builderResult.sessionId },
    });

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
        await state.record({ at: now(), type: "probe_planned", packetId: packet.id });
      }
      const probeOutcome = await runShadowProbes(
        packet,
        plan,
        options,
        deps,
        state,
        refinementUsed,
      );
      plan = probeOutcome.plan;
      refinementUsed = probeOutcome.refinementUsed;
      report = probeOutcome.report;
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
      requireRootCauseFirst = decision.requireRootCauseFirst;
      continue;
    }

    await blockPacket(deps, state, packet, catalogStatus, "shadow attempts exhausted");
    return;
  }
}

interface ProbeOutcome {
  report: ShadowReport;
  plan: ProbePlan;
  refinementUsed: boolean;
}

async function runShadowProbes(
  packet: WorkPacket,
  plan: ProbePlan,
  options: PipelineOptions,
  deps: PipelineDeps,
  state: RunStateStore,
  refinementUsed: boolean,
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
    return { report: applicationFailureReport(packet.id, error), plan, refinementUsed };
  }

  try {
    let currentPlan = plan;
    let used = refinementUsed;
    const runOptions = { stepTimeoutMs: 2_000, caseTimeoutMs: 15_000 };
    let report = await deps.runner.run(currentPlan, {
      baseUrl: application.baseUrl,
      ...runOptions,
    });
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
          report = await deps.runner.run(currentPlan, {
            baseUrl: application.baseUrl,
            ...runOptions,
          });
          await state.record({
            at: now(),
            type: "probe_finished",
            packetId: packet.id,
            detail: { verdict: report.verdict, refined: true },
          });
        } catch (error) {
          used = true;
          await state.record({
            at: now(),
            type: "probe_refinement_failed",
            packetId: packet.id,
            detail: { message: errorMessage(error) },
          });
        }
      }
    }
    return { report, plan: currentPlan, refinementUsed: used };
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
  try {
    return await deps.planner.plan(packet);
  } catch (error) {
    await state.record({
      at: now(),
      type: "probe_planner_retry",
      packetId: packet.id,
      detail: { message: errorMessage(error) },
    });
  }
  const retryDelayMs = options.plannerRetryDelayMs ?? 2_000;
  if (retryDelayMs > 0) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, retryDelayMs));
  }
  try {
    return await deps.planner.plan(packet);
  } catch (error) {
    await state.record({
      at: now(),
      type: "probe_planner_failed",
      packetId: packet.id,
      detail: { message: errorMessage(error) },
    });
    return undefined;
  }
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

function deliveryFailureReport(report: FinalVerificationReport): ShadowReport {
  return {
    packetId: "delivery-repair",
    verdict: "fail",
    passedCases: [],
    failures: [
      {
        caseId: "<delivery>",
        stepIndex: -1,
        category: "runner",
        message: report.message,
      },
    ],
  };
}

async function runFinalVerifier(
  options: PipelineOptions,
  deps: PipelineDeps,
): Promise<FinalVerificationReport> {
  try {
    return await deps.finalVerifier.verify(
      options.outputDir,
      options.platformContract,
    );
  } catch (error) {
    return {
      ok: false,
      stage: "readiness",
      message: errorMessage(error),
    };
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

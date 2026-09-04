import type { BuilderPort } from "./builder/port.js";
import { loadRequirementCatalog } from "./catalog.js";
import type { GitOps } from "./git-ops.js";
import type {
  FinalVerificationReport,
  FinalVerifierPort,
} from "./final-verifier.js";
import type { ProbePlanner } from "./judge/llm-probe-planner.js";
import type { PlaywrightProbeRunner } from "./judge/playwright-probe-runner.js";
import type { ProbePlan } from "./judge/probe-schema.js";
import { RunStateStore, decideAfterReport } from "./run-state.js";
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

export interface PipelineDeps {
  builder: BuilderPort;
  planner: ProbePlanner;
  runner: Pick<PlaywrightProbeRunner, "run">;
  git: GitOps;
  appLifecycle: AppLifecycle;
  clock: Clock;
  finalVerifier: FinalVerifierPort;
}

export interface PipelineOptions {
  requirementsFile: string;
  outputDir: string;
  ledgerFile: string;
  totalBudgetMs: number;
  platformContract: PlatformContract;
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
  );

  await state.record({ at: now(), type: "pipeline_started" });
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
      const builderResult = await deps.builder.run({
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

  while (true) {
    const packet: WorkPacket = { ...selected, attempt };
    state.setPacketAttempt(packet.id, attempt);
    const builderResult = await deps.builder.run({
      packet,
      outputDir: options.outputDir,
      platformContract: options.platformContract,
      ...(previousReport ? { shadowReport: previousReport } : {}),
      requireRootCauseFirst,
    });
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
        plan = await deps.planner.plan(packet);
        await state.record({ at: now(), type: "probe_planned", packetId: packet.id });
      }
      const application = await deps.appLifecycle.start(
        options.outputDir,
        options.platformContract,
      );
      try {
        report = await deps.runner.run(plan, {
          baseUrl: application.baseUrl,
          stepTimeoutMs: 2_000,
          caseTimeoutMs: 15_000,
        });
        await state.record({
          at: now(),
          type: "probe_finished",
          packetId: packet.id,
          detail: { verdict: report.verdict },
        });

        if (report.verdict === "inconclusive" && !refinementUsed) {
          const snapshot = report.failures.find(
            (failure) => failure.category === "locator" && failure.locatorSnapshot,
          )?.locatorSnapshot;
          if (snapshot) {
            plan = await deps.planner.refineLocators(plan, snapshot);
            refinementUsed = true;
            await state.record({ at: now(), type: "probe_refined", packetId: packet.id });
            report = await deps.runner.run(plan, {
              baseUrl: application.baseUrl,
              stepTimeoutMs: 2_000,
              caseTimeoutMs: 15_000,
            });
            await state.record({
              at: now(),
              type: "probe_finished",
              packetId: packet.id,
              detail: { verdict: report.verdict, refined: true },
            });
          }
        }
      } finally {
        await application.stop();
      }
    }

    const decision = decideAfterReport(report, attempt, refinementUsed);
    if (decision.kind === "accept") {
      const acceptedSha = await deps.git.captureAccepted(`shallow: accept ${packet.id}`);
      state.setAcceptedSha(acceptedSha);
      state.markRequirements(packet.requirementIds, "verified");
      setCatalogStatus(catalogStatus, packet.requirementIds, "verified");
      await state.record({ at: now(), type: "packet_accepted", packetId: packet.id });
      return;
    }
    if (decision.kind === "repair") {
      previousReport = report;
      attempt = decision.nextAttempt;
      requireRootCauseFirst = decision.requireRootCauseFirst;
      continue;
    }
    if (decision.kind === "refine_locators") {
      previousReport = report;
      attempt = attempt === 3 ? 3 : ((attempt + 1) as 2 | 3);
      requireRootCauseFirst = attempt === 3;
      continue;
    }

    await deps.git.restoreAccepted(state.snapshot.acceptedSha);
    state.markRequirements(packet.requirementIds, "blocked");
    setCatalogStatus(catalogStatus, packet.requirementIds, "blocked");
    await state.record({ at: now(), type: "packet_blocked", packetId: packet.id });
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
      message: error instanceof Error ? error.message : String(error),
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

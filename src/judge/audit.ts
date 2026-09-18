import type { PipelineDeps, PipelineOptions, AppLifecycle } from "../pipeline.js";
import type { WorkPacket, ShadowReport } from "../types.js";
import type { RunStateStore } from "../run-state.js";
import { ExecutionFault } from "../execution-fault.js";
import { ProbePlannerError, type ProbePlannerFeedback } from "./llm-probe-planner.js";
import { assertLocatorOnlyRefinement, parseProbePlan, probePlanSha256, type ProbePlan } from "./probe-schema.js";

interface ProbeOutcome { source: "application" | "probe"; report: ShadowReport; plan: ProbePlan }
export interface AuditResult {
  status: "verified" | "failed" | "inconclusive";
  plan?: ProbePlan;
  report?: ShadowReport;
  reason?: string;
}

/** Only reproducible business failures are eligible for application repair. */
export async function auditPacket(packet: WorkPacket, cached: ProbePlan | undefined,
  options: PipelineOptions, deps: PipelineDeps, state: RunStateStore, remaining: () => number,
): Promise<AuditResult> {
  let plan = cached;
  try {
    if (remaining() <= 0) return { status: "inconclusive", plan, reason: "audit budget exhausted" };
    plan ??= await planProbe(packet, options, deps, state, remaining);
    if (!plan) return { status: "inconclusive", reason: "probe planner failed" };
    await state.record({ at: now(), type: "probe_planned", packetId: packet.id, detail: { cases: plan.cases.length } });
    const recovery = { browserRetries: 0, locatorRefinements: 0 };
    const first = await runShadowProbes(packet, plan, options, deps, state, recovery, remaining);
    plan = first.plan;
    if (first.report.verdict === "pass") return { status: "verified", plan, report: first.report };
    if (first.source !== "probe" || first.report.failures.some(item => item.category === "locator" || item.category === "runner")) {
      return { status: "inconclusive", plan, report: first.report, reason: "Judge could not establish valid behavior evidence" };
    }
    if (remaining() <= 0) return { status: "inconclusive", plan, reason: "failure confirmation budget exhausted" };
    // Fresh application state: failed actions may have changed server-side data.
    const confirmed = await runShadowProbes(packet, plan, options, deps, state, recovery, remaining);
    plan = confirmed.plan;
    const key = (report: ShadowReport) => JSON.stringify(report.failures.map(item => [item.caseId, item.stepIndex, item.category]).sort());
    const stable = confirmed.source === "probe" && confirmed.report.verdict === "fail" && key(first.report) === key(confirmed.report);
    return { status: stable ? "failed" : "inconclusive", plan, report: confirmed.report,
      ...(stable ? {} : { reason: "failure was not reproducible" }) };
  } catch (error) {
    // Judge faults do not edit or discard the buildable application checkpoint.
    await state.record({ at: now(), type: "execution_fault", packetId: packet.id,
      detail: { source: "judge", message: errorMessage(error), retry: false } });
    return { status: "inconclusive", plan, reason: errorMessage(error) };
  }
}

async function runShadowProbes(
  packet: WorkPacket,
  plan: ProbePlan,
  options: PipelineOptions,
  deps: PipelineDeps,
  state: RunStateStore,
  recovery: { browserRetries: number; locatorRefinements: number },
  remaining: () => number,
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
        if (remaining() <= 0) throw new Error("Audit phase budget exhausted");
        const startedAt = deps.clock.nowMs();
        await state.record({ at: now(), type: "probe_started", packetId: packet.id,
          detail: { cases: currentPlan.cases.length, retryCount: recovery.browserRetries,
            planSha256: probePlanSha256(currentPlan) } });
        try {
          const report = await deps.runner.run(currentPlan, { baseUrl: application.baseUrl, ...runOptions, caseTimeoutMs: Math.max(1, Math.min(runOptions.caseTimeoutMs, remaining())) });
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
            remaining() > 0;
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
    while (report.verdict !== "pass" &&
      report.failures.some((failure) => failure.locatorSnapshot) &&
      recovery.locatorRefinements < MAX_LOCATOR_REFINEMENTS &&
      remaining() > 0) {
      const refinementAttempt = ++recovery.locatorRefinements;
      const beforePlanSha256 = probePlanSha256(currentPlan);
      let refined: ProbePlan;
      try {
        // Pass a copy so a planner implementation cannot mutate the behavior being checked.
        refined = parseProbePlan(await deps.planner.refineLocators(
          structuredClone(currentPlan), structuredClone(report.failures.filter(failure => failure.category === "locator")), feedback,
          { timeoutMs: Math.max(1, Math.min(PLANNER_ATTEMPT_TIMEOUT_MS, remaining())) },
        ));
        assertLocatorOnlyRefinement(currentPlan, refined, report.failures.filter(failure => failure.category === "locator"));
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
      if (remaining() <= 0) break;
      currentPlan = refined;
      feedback = undefined;
      await state.record({ at: now(), type: "probe_refined", packetId: packet.id,
        detail: { refinementAttempt, beforePlanSha256, planSha256: probePlanSha256(currentPlan) } });
      // Browser failures use their own shared quota, outside the planner error handler.
      report = await run();
    }
    return { source: "probe", report, plan: currentPlan };
  } finally {
    // application_stopped pairs with application_starting/ready and must be
    // recorded even if shutdown or the post-stop integrity check throws;
    // otherwise the run log shows a started-but-never-stopped application.
    try {
      await application.stop();
      await application.assertUnchanged?.();
      if (application.candidate) await deps.candidate?.assertCurrent(application.candidate);
    } finally {
      await state.record({ at: now(), type: "application_stopped", packetId: packet.id });
    }
  }
}

const MAX_LOCATOR_REFINEMENTS = 2;

// Reasoning models behind the gateway can spend well over a minute on a full
// plan; a 45s cap timed out every larger packet while small ones succeeded.
const PLANNER_ATTEMPT_TIMEOUT_MS = 180_000;

async function planProbe(
  packet: WorkPacket,
  options: PipelineOptions,
  deps: PipelineDeps,
  state: RunStateStore,
  remaining: () => number,
): Promise<ProbePlan | undefined> {
  await state.record({ at: now(), type: "probe_planning", packetId: packet.id });
  let feedback: ProbePlannerFeedback | undefined;
  try {
    return parseProbePlan(await deps.planner.plan(packet, undefined, { timeoutMs: Math.max(1, Math.min(PLANNER_ATTEMPT_TIMEOUT_MS, remaining())) }), packet);
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
  if (remaining() <= 0) return undefined;
  const retryDelayMs = options.plannerRetryDelayMs ?? 2_000;
  if (retryDelayMs > 0) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(retryDelayMs, remaining())));
  }
  if (remaining() <= 0) return undefined;
  try {
    return parseProbePlan(await deps.planner.plan(packet, feedback, { timeoutMs: Math.max(1, Math.min(PLANNER_ATTEMPT_TIMEOUT_MS, remaining())) }), packet);
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


function now(): string { return new Date().toISOString(); }

import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  BuilderPort,
  BuilderRequest,
  BuilderResult,
  BuilderRunOptions,
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
import { ProbePlannerError, type ProbePlanner } from "./judge/llm-probe-planner.js";
import type { PlaywrightProbeRunner } from "./judge/playwright-probe-runner.js";
import { RunStateStore, sanitizeDiagnosticText, type LogSink } from "./run-state.js";
import { featureGroupPackets, auditPackets, folderDescendants, makePacket } from "./scheduler.js";
import { RunBudget, type PipelinePhase } from "./run-budget.js";
import { auditPacket, type AuditResult } from "./judge/audit.js";
import { probePlanSha256 } from "./judge/probe-schema.js";
import { PlanCache, spawnPlanGeneration } from "./judge/plan-cache.js";
import { progressPlansDirectory } from "./progress-journal.js";
import { memorySnapshot } from "./memory-snapshot.js";
import { ExecutionFault } from "./execution-fault.js";
import { GatewayRequestError } from "./gateway-failure.js";
import { GatewayRecovery } from "./gateway-recovery.js";
import type { CandidateRuntime } from "./candidate-runtime.js";
import type { CandidateEvidence } from "./types.js";
import type {
  PlatformContract,
  RequirementCatalog,
  RequirementStatus,
  WorkPacket,
} from "./types.js";

const BOUNDARY_REPAIR_CALL_CEILING_MS = 5_400_000;
const IMPLEMENTATION_CALL_CEILING_MS = 5_400_000;
const IMPLEMENTATION_RETRY_CEILING_MS = 2_700_000;
/** A single Judge operation may recover from transient faults, but cannot own an unlimited run. */
const PLANNER_RECOVERY_WINDOW_MS = 720_000;
/** Delivery repairs get longer calls and more rounds than other fixes: the
 * candidate goes straight to the grader, so delivery must be given every chance. */
const DELIVERY_REPAIR_CALL_CEILING_MS = 1_800_000;
const MAX_DELIVERY_REPAIR_ROUNDS = 3;

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
  gatewayRecovery?: GatewayRecovery;
}

export interface PipelineOptions {
  requirementsFile: string;
  outputDir: string;
  ledgerFile: string;
  totalBudgetMs: number;
  platformContract: PlatformContract;
  plannerRetryDelayMs?: number;
  /** Product-visible journal directory (`shallow-progress`); plans mirror here. */
  progressDir?: string;
}

export interface RunSummary {
  status: "delivered" | "partial" | "failed";
  verifiedRequirementIds: string[];
  blockedRequirementIds: string[];
  acceptedSha: string;
  implementedRequirementIds?: string[];
  failedRequirementIds?: string[];
  inconclusiveRequirementIds?: string[];
  pendingRequirementIds?: string[];
}

export async function runPipeline(options: PipelineOptions, deps: PipelineDeps): Promise<RunSummary> {
  const catalog = await loadRequirementCatalog(options.requirementsFile);
  const startedAt = deps.clock.nowMs();
  const budget = new RunBudget(options.totalBudgetMs, startedAt, () => deps.clock.nowMs());
  const state = new RunStateStore({ statusByRequirementId: catalog.statusById,
    acceptedSha: await deps.git.captureAccepted("shallow: initial state"), startedAtMs: startedAt,
    totalBudgetMs: options.totalBudgetMs }, options.ledgerFile, deps.logSink ?? null, deps.diagnosticSecrets);
  const implemented = new Set<string>();
  const packets = auditPackets(catalog);
  const featureGrouping = featureGroupPackets(catalog);
  const requirementById = new Map(catalog.requirements.map(item => [item.id, item]));
  const auditPacketByRequirementId = new Map(packets.flatMap(packet =>
    packet.requirementIds.map(id => [id, packet] as const)));
  const planCache = new PlanCache(dirname(options.ledgerFile),
    options.progressDir ? progressPlansDirectory(options.progressDir) : undefined);
  let results = new Map<string, AuditResult>();
  let boundaryRepairCount = 0;
  let currentBoundaryModule: string | undefined;
  let gatewayPhase: PipelinePhase = "implementation";
  const pendingPlans = new Map<string, Promise<unknown>>();
  const gateway = deps.gatewayRecovery ?? new GatewayRecovery();
  const dependencyClosure = (requirementIds: readonly string[]): Set<string> => {
    const closure = new Set<string>();
    const pending = requirementIds.flatMap(id => requirementById.get(id)?.dependencyIds ?? []);
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (closure.has(id)) continue;
      closure.add(id);
      pending.push(...(requirementById.get(id)?.dependencyIds ?? []));
    }
    return closure;
  };
  const verificationStatus = (requirementId: string): RequirementStatus => {
    const auditPacket = auditPacketByRequirementId.get(requirementId);
    return (auditPacket ? results.get(auditPacket.id)?.status : undefined)
      ?? state.snapshot.statusByRequirementId[requirementId]
      ?? "todo";
  };
  const unmetVerifiedDependencies = (packet: WorkPacket, moduleId: string): Array<{ id: string; status: RequirementStatus }> => {
    const packetIds = new Set(packet.requirementIds);
    return [...dependencyClosure(packet.requirementIds)]
      .filter(id => !packetIds.has(id))
      .filter(id => {
        const dependency = requirementById.get(id);
        const dependencyModuleId = dependency?.folderPath[1] ?? dependency?.id;
        const auditPacket = auditPacketByRequirementId.get(id);
        // Dependencies in the current, not-yet-audited module remain eligible.
        // Cross-module dependencies and already-decided local dependencies must
        // independently pass before more code is generated on top of them.
        return dependencyModuleId !== moduleId
          || (auditPacket !== undefined && results.has(auditPacket.id))
          || verificationStatus(id) !== "todo";
      })
      .map(id => ({ id, status: verificationStatus(id) }))
      .filter(item => item.status !== "verified")
      .sort((left, right) => left.id.localeCompare(right.id));
  };
  gateway.setRecorder(({ packetId, ...detail }) => state.record({ at: now(), type: "gateway_wait", packetId, detail }));
  const planner = deps.planner;
  const plannerWindow = (): (() => number) => {
    const phase = gatewayPhase;
    const deadline = options.totalBudgetMs <= 0 ? deps.clock.nowMs() + PLANNER_RECOVERY_WINDOW_MS : Infinity;
    return () => Math.min(budget.remaining(phase), deadline - deps.clock.nowMs());
  };
  deps = { ...deps, planner: {
    plan: (packet, feedback, callOptions) => {
      const remaining = plannerWindow();
      return gateway.run("planner", packet.id, remaining,
        () => planner.plan(packet, feedback, { timeoutMs: Math.max(1, Math.min(callOptions?.timeoutMs ?? Infinity, remaining())) }));
    },
    refineLocators: (original, failures, feedback, callOptions) => {
      const remaining = plannerWindow();
      return gateway.run("planner", original.packetId, remaining,
        () => planner.refineLocators(original, failures, feedback, { timeoutMs: Math.max(1, Math.min(callOptions?.timeoutMs ?? Infinity, remaining())) }));
    },
    reviewPlan: (packet, original, failures, feedback, callOptions) => {
      const remaining = plannerWindow();
      return gateway.run("planner", packet.id, remaining,
        () => planner.reviewPlan(packet, original, failures, feedback, { timeoutMs: Math.max(1, Math.min(callOptions?.timeoutMs ?? Infinity, remaining())) }));
    },
  } };
  deps.candidate?.setRecorder(event => state.record(event));

  const phase = async (name: PipelinePhase, round?: number): Promise<void> => {
    gatewayPhase = name;
    const remaining = budget.remaining(name);
    await state.record({ at: now(), type: "phase_started", detail: { phase: name, round,
      memory: await memorySnapshot(),
      ...(Number.isFinite(remaining) ? { remainingMs: remaining } : {}) } });
  };
  const build = async (request: BuilderRequest, name: PipelinePhase, runOptions: BuilderRunOptions = {}): Promise<BuilderResult> => {
    const packetId = "packet" in request ? request.packet.id : "delivery-repair";
    const ceiling = name === "implementation" ? IMPLEMENTATION_CALL_CEILING_MS : name === "repair" ? BOUNDARY_REPAIR_CALL_CEILING_MS : DELIVERY_REPAIR_CALL_CEILING_MS;
    const deadline = deps.clock.nowMs() + Math.min(ceiling, runOptions.timeoutMs ?? ceiling);
    const remaining = () => Math.min(deadline - deps.clock.nowMs(), budget.remaining(name));
    if (remaining() <= 0) return { outcome: "timed_out", sessionId: "unavailable", summary: "phase budget exhausted" };
    state.setPacketAttempt(packetId, "packet" in request ? request.packet.attempt : 1);
    let lastResult: BuilderResult | undefined;
    try {
      return await gateway.run("builder", packetId, remaining, async () => {
        await state.record({ at: now(), type: "builder_started", packetId, detail: { mode: request.mode } });
        const at = deps.clock.nowMs();
        let result: BuilderResult;
        try { result = await deps.builder.run(request, { ...runOptions, timeoutMs: Math.max(1, Math.floor(remaining())) }); }
        catch (error) {
          if (error instanceof ExecutionFault) throw error;
          result = { outcome: "failed", sessionId: "unavailable", summary: errorMessage(error),
            ...(error instanceof GatewayRequestError ? { gatewayFailure: error.gatewayFailure } : {}) };
        }
        lastResult = result;
        await state.record({ at: now(), type: "builder_finished", packetId,
          detail: { ...result, durationMs: Math.max(0, deps.clock.nowMs() - at) } });
        if (result.referenceImages) await state.record({ at: now(), type: "builder_reference_images", packetId, detail: result.referenceImages });
        if (result.outcome !== "completed" && result.gatewayFailure) {
          if (request.mode === "implement") await preserveInterruptedWork(request.packet);
          throw new GatewayRequestError(result.gatewayFailure);
        }
        return result;
      });
    } catch (error) {
      if (error instanceof ExecutionFault) throw error;
      if (!(error instanceof GatewayRequestError)) throw error;
      return { ...lastResult, sessionId: lastResult?.sessionId ?? "unavailable", outcome: "failed",
        summary: lastResult?.summary ?? error.message, gatewayFailure: error.gatewayFailure };
    }
  };
  /**
   * A gateway outage pauses work instead of ending the run: retry the same
   * builder call with a fresh window while the failure is retryable. A
   * non-retryable rejection (authentication or a request error) ends the loop
   * so the caller can stop dispatching instead of spinning without backoff.
   */
  const resumeGatewayWork = async (
    current: BuilderResult,
    emitPause: (failure: NonNullable<BuilderResult["gatewayFailure"]>) => Promise<void>,
    retry: () => Promise<BuilderResult>,
  ): Promise<BuilderResult> => {
    while (current.gatewayFailure?.retryable && current.outcome !== "completed" && !gateway.exhausted) {
      await emitPause(current.gatewayFailure);
      current = await retry();
    }
    return current;
  };
  const stopImplementation = async (packet: WorkPacket,
    failure: NonNullable<BuilderResult["gatewayFailure"]>): Promise<void> => {
    await state.record({ at: now(), type: "implementation_stopped", packetId: packet.id,
      detail: { requirementIds: packet.requirementIds, failure } });
  };
  const runnable = async (): Promise<CandidateEvidence | undefined> => {
    const app = await deps.appLifecycle.start(options.outputDir, options.platformContract);
    try { await app.assertUnchanged?.(); }
    finally { await app.stop(); }
    await app.assertUnchanged?.();
    if (app.candidate) await deps.candidate?.assertCurrent(app.candidate);
    return app.candidate;
  };
  const checkpoint = async (ids: string[], reason: string, candidate?: CandidateEvidence): Promise<void> => {
    if (candidate) await deps.candidate?.assertCurrent(candidate);
    const sha = await deps.git.captureAccepted(`shallow: checkpoint ${reason}`);
    if (candidate) await deps.candidate?.assertCurrent(candidate);
    state.setAcceptedSha(sha);
    if (candidate) deps.candidate?.recordAccepted(candidate);
    await state.record({ at: now(), type: "checkpoint_saved", detail: { requirementIds: ids, reason, candidate } });
    await emitArc(deps, state, arc => arc.commitHistorySignal("git_commit"));
  };
  const preserveInterruptedWork = async (packet: WorkPacket): Promise<void> => {
    if (!await deps.git.hasApplicationChanges(state.snapshot.acceptedSha)) return;
    await deps.git.captureAccepted(`shallow: interrupted attempt ${packet.id}`);
    let candidate: CandidateEvidence | undefined;
    let preserved = false;
    try { candidate = await runnable(); preserved = true; }
    catch { await deps.git.restoreAccepted(state.snapshot.acceptedSha); }
    if (preserved) await checkpoint([], `interrupted ${packet.id}`, candidate);
    await state.record({ at: now(), type: "builder_work_preserved", packetId: packet.id,
      detail: { preserved, requirementIds: packet.requirementIds } });
  };
  const audit = async (name: PipelinePhase, previous = results): Promise<Map<string, AuditResult>> => {
    const audited = new Map<string, AuditResult>();
    // Previously passed paths are checked first after edits, so regressions stop repairs early.
    const ordered = [...packets].sort((a, b) => Number(previous.get(b.id)?.status === "verified") - Number(previous.get(a.id)?.status === "verified"));
    for (const packet of ordered) {
      if (!packet.requirementIds.every(id => implemented.has(id))) continue;
      const cached = previous.get(packet.id)?.plan ?? await planCache.read(packet);
      const result = previous.get(packet.id)?.reason === "gateway recovery window exhausted" && !cached
        ? previous.get(packet.id)!
        : budget.remaining(name) <= 0
        ? { status: "inconclusive" as const, plan: cached, reason: "audit phase budget exhausted" }
        : await auditPacket(packet, cached, options, deps, state, () => budget.remaining(name), { refineLocators: false });
      // Detection-only audits never refine; persist a freshly planned result so
      // future audits skip the LLM call.
      if (result.plan && (!cached || probePlanSha256(result.plan) !== probePlanSha256(cached))) {
        await planCache.write(packet.id, result.plan).catch(() => {});
      }
      audited.set(packet.id, result);
    }
    return audited;
  };
  const publish = async (): Promise<void> => {
    for (const packet of packets) {
      const result = results.get(packet.id);
      if (!result) continue;
      state.markRequirements(packet.requirementIds, result.status);
      await state.record({ at: now(), type: "audit_result", packetId: packet.id,
        detail: { requirementIds: packet.requirementIds, status: result.status, reason: result.reason } });
      // The platform has no inconclusive status: leave implementation completed, never claim passed.
      for (const id of packet.requirementIds) {
        if (result.status !== "inconclusive") await emitArc(deps, state, arc => arc.requirementState(id, "test", result.status === "verified" ? "passed" : "failed"));
        else await emitArc(deps, state, arc => arc.requirementState(id, "implement", "completed"));
      }
    }
  };
  const runModuleBoundaryAudit = async (packetIds: string[], moduleId: string, moduleName: string | undefined): Promise<void> => {
    await Promise.allSettled(packetIds.map(id => pendingPlans.get(id)).filter((plan): plan is Promise<unknown> => plan !== undefined));
    gatewayPhase = "audit";
    if (budget.remaining("audit") <= 0) return;
    // Reset per-module boundary repair quota when switching modules.
    if (currentBoundaryModule !== moduleId) {
      boundaryRepairCount = 0;
      currentBoundaryModule = moduleId;
    }
    await state.record({ at: now(), type: "phase_started", detail: { phase: "audit" as const,
      round: undefined, memory: await memorySnapshot(),
      ...(Number.isFinite(budget.remaining("audit")) ? { remainingMs: budget.remaining("audit") } : {}) } });
    const targetPackets = packets.filter(p => packetIds.includes(p.id));
    const ordered = [...targetPackets].sort((a, b) => Number(results.get(b.id)?.status === "verified") - Number(results.get(a.id)?.status === "verified"));
    const boundaryResults = new Map<string, AuditResult>();
    for (const packet of ordered) {
      if (!packet.requirementIds.every(id => implemented.has(id))) continue;
      const cached = results.get(packet.id)?.plan ?? await planCache.read(packet);
      if (budget.remaining("audit") <= 0) {
        boundaryResults.set(packet.id, { status: "inconclusive", plan: cached, reason: "module boundary audit budget exhausted" });
        continue;
      }
      const result = await auditPacket(packet, cached, options, deps, state, () => budget.remaining("audit"));
      if (result.plan && (!cached || probePlanSha256(result.plan) !== probePlanSha256(cached))) {
        await planCache.write(packet.id, result.plan).catch(() => {});
      }
      boundaryResults.set(packet.id, result);
    }
    // Merge boundary results into the main results map (final audit_result events come from publish).
    for (const [id, result] of boundaryResults) {
      results.set(id, result);
    }
    await state.record({ at: now(), type: "module_boundary_audit_finished",
      detail: { moduleId, moduleName, packetIds, results: Object.fromEntries([...boundaryResults].map(([id, r]) => [id, r.status])) } });
    // Inline repair for module boundary failures, using per-module repair budget.
    while (boundaryRepairCount < 2 && budget.remaining("repair") > 0) {
      const failures = targetPackets.filter(p => {
        const result = results.get(p.id);
        return result?.status === "failed" || result?.repairableLocatorFailure;
      });
      if (!failures.length) break;
      const round = ++boundaryRepairCount;
      for (const item of failures) state.setPacketAttempt(item.id, round + 1);
      await phase("repair", round);
      const repairPacket = makePacket(`repair-round-${round}`, failures.flatMap(item => item.requirements), round === 1 ? 2 : 3);
      const reports = failures.map(item => results.get(item.id)!.report!);
      const observation = toBuilderShadowObservation({ packetId: repairPacket.id,
        verdict: failures.some(item => results.get(item.id)?.status === "failed") ? "fail" : "inconclusive", passedCases: [],
        failures: reports.flatMap(report => report.failures) }, deps.diagnosticSecrets);
      await state.record({ at: now(), type: "repair_batch_started", detail: { round, requirementIds: repairPacket.requirementIds } });
      const repairTimeoutMs = Math.max(1, Math.floor(Math.min(BOUNDARY_REPAIR_CALL_CEILING_MS, budget.remaining("repair") / 2)));
      let repairResult = await build({ mode: "repair", packet: repairPacket, projectContext: buildBuilderProjectContext(repairPacket, catalog, implemented),
        outputDir: options.outputDir, platformContract: options.platformContract, shadowObservation: observation },
        "repair", { timeoutMs: repairTimeoutMs });
      // Same recovery rule as implementation: an outage postpones the repair
      // instead of abandoning an entire module while its quota is untouched.
      repairResult = await resumeGatewayWork(repairResult,
        failure => state.record({ at: now(), type: "repair_paused", packetId: repairPacket.id,
          detail: { requirementIds: repairPacket.requirementIds, failure } }),
        () => build({ mode: "repair", packet: repairPacket, projectContext: buildBuilderProjectContext(repairPacket, catalog, implemented),
          outputDir: options.outputDir, platformContract: options.platformContract, shadowObservation: observation },
        "repair", { timeoutMs: repairTimeoutMs }));
      let reason = repairResult.outcome === "completed" ? "" : repairResult.summary || repairResult.outcome;
      let candidate: CandidateEvidence | undefined;
      if (!reason) {
        try { candidate = await runnable(); } catch (error) { reason = errorMessage(error); }
      }
      let nextResults = results;
      if (!reason) {
        // A boundary repair may break a module path that already passed. Recheck
        // this module's verified packets first and discard the repair on the first
        // loss; only then look for improvement across the failed packets.
        let regressed = false;
        const rechecked = new Map<string, AuditResult>();
        for (const packet of targetPackets) {
          if (results.get(packet.id)?.status !== "verified") continue;
          if (budget.remaining("repair") <= 0) { regressed = true; break; }
          const cachedPlan = results.get(packet.id)?.plan ?? await planCache.read(packet);
          const recheck = await auditPacket(packet, cachedPlan, options, deps, state, () => budget.remaining("repair"));
          if (recheck.status !== "verified") { regressed = true; break; }
          rechecked.set(packet.id, recheck);
        }
        const reAudit = new Map<string, AuditResult>();
        if (!regressed) {
          // Re-audit the failed packets with cached plans.
          for (const packet of failures) {
            const cachedPlan = results.get(packet.id)?.plan ?? await planCache.read(packet);
            const r = budget.remaining("repair") <= 0
              ? { status: "inconclusive" as const, plan: cachedPlan, reason: "module boundary repair budget exhausted" }
              : await auditPacket(packet, cachedPlan, options, deps, state, () => budget.remaining("repair"));
            reAudit.set(packet.id, r);
          }
        }
        const improved = failures.some(item => reAudit.get(item.id)?.status === "verified");
        if (regressed) reason = "previously verified behavior was lost or could not be reverified";
        else if (!improved) reason = "repair produced no independently verified improvement";
        else {
          // The repair is kept, so locator refinements the rechecks needed survive
          // too: detection-only audits cannot refine again and would otherwise
          // demote these verified packets with the pre-repair plans.
          for (const [id, recheck] of rechecked) {
            const previousPlan = results.get(id)?.plan;
            if (recheck.plan && (!previousPlan || probePlanSha256(recheck.plan) !== probePlanSha256(previousPlan))) {
              await planCache.write(id, recheck.plan).catch(() => {});
              nextResults = new Map(nextResults);
              nextResults.set(id, recheck);
            }
          }
          for (const [id, r] of reAudit) {
            nextResults = new Map(nextResults);
            nextResults.set(id, r);
          }
        }
      }
      if (reason) {
        await deps.git.restoreAccepted(state.snapshot.acceptedSha);
        await state.record({ at: now(), type: "repair_batch_finished", detail: { round, retained: false, reason } });
        break;
      }
      await checkpoint(repairPacket.requirementIds, repairPacket.id, candidate);
      results = nextResults;
      await state.record({ at: now(), type: "repair_batch_finished", detail: { round, retained: true, reason: "verified improvement with regression coverage" } });
    }
  };

  await state.record({ at: now(), type: "pipeline_started", detail: {
    requirements: catalog.requirements.length, totalBudgetMs: options.totalBudgetMs, port: options.platformContract.port,
    grouping: featureGrouping.stats, ...deps.runMetadata } });
  await emitArc(deps, state, arc => arc.runnerState("running", "feature-group pipeline started"));
  const rows = buildArcRequirementRows(catalog.tree);
  await emitArc(deps, state, arc => arc.storeRequirementTree(rows.requirementRows, rows.scenarioRows));
  const folderMap = folderDescendants(catalog);
  // The platform counts FOLDER nodes as requirements too; derive their state
  // from their atomic descendants so the functional-rate denominator is covered.
  const emitFolderRollup = async (): Promise<void> => {
    const statuses = state.snapshot.statusByRequirementId;
    const folders = [...folderMap].sort(([, left], [, right]) => left.length - right.length);
    for (const [folderId, leaves] of folders) {
      if (!leaves.length) continue;
      const implementedLeaves = leaves.filter(id => implemented.has(id));
      await emitArc(deps, state, arc => arc.requirementState(folderId, "design", "running"));
      await emitArc(deps, state, arc => arc.requirementState(folderId, "design", "completed"));
      await emitArc(deps, state, arc => arc.requirementState(folderId, "implement", "running"));
      await emitArc(deps, state, arc => arc.requirementState(folderId, "implement", implementedLeaves.length === leaves.length ? "completed" : "failed"));
      const allVerified = leaves.every(id => statuses[id] === "verified");
      await emitArc(deps, state, arc => arc.requirementState(folderId, "test", allVerified ? "passed" : "failed"));
    }
  };
  try {
    await phase("implementation");
    let previousModuleId: string | undefined;
    const pendingModuleAudit: { packetIds: string[]; moduleId: string } = { packetIds: [], moduleId: "" };
    for (let packetIndex = 0; packetIndex < featureGrouping.packets.length; packetIndex++) {
      const packet = featureGrouping.packets[packetIndex];
      if (budget.remaining("implementation") <= 0 || gateway.exhausted) break;
      const currentModuleId = packet.requirements[0]?.folderPath[1] ?? packet.requirements[0]?.id;
      // Module boundary: run full audit on the previous module before starting the next one.
      if (previousModuleId !== undefined && currentModuleId !== previousModuleId && pendingModuleAudit.packetIds.length > 0) {
        await runModuleBoundaryAudit(pendingModuleAudit.packetIds, pendingModuleAudit.moduleId, previousModuleId);
        pendingModuleAudit.packetIds = [];
      }
      pendingModuleAudit.moduleId = currentModuleId;
      gatewayPhase = "implementation";
      await state.record({ at: now(), type: "packet_selected", packetId: packet.id,
        detail: { requirementIds: packet.requirementIds, names: packet.requirements.map(item => item.name) } });
      for (const id of packet.requirementIds) {
        // Design is folded into the implementation turn; keep the platform's phase trace complete.
        await emitArc(deps, state, arc => arc.requirementState(id, "design", "running"));
        await emitArc(deps, state, arc => arc.requirementState(id, "design", "completed"));
        await emitArc(deps, state, arc => arc.requirementState(id, "implement", "running"));
      }
      const unmetDependencies = unmetVerifiedDependencies(packet, currentModuleId);
      if (unmetDependencies.length > 0) {
        state.markRequirements(packet.requirementIds, "blocked");
        await state.record({ at: now(), type: "dependency_gate_blocked", packetId: packet.id,
          detail: { requirementIds: packet.requirementIds,
            unmetDependencyIds: unmetDependencies.map(item => item.id),
            dependencyStatuses: Object.fromEntries(unmetDependencies.map(item => [item.id, item.status])) } });
        for (const id of packet.requirementIds) {
          await emitArc(deps, state, arc => arc.requirementState(id, "implement", "failed"));
        }
        previousModuleId = currentModuleId;
        continue;
      }
      // Spawn plan generation in parallel with Builder execution.
      // The corresponding audit packets get their plans pre-computed.
      const relatedAuditPackets = packets.filter(p => packet.requirementIds.some(id => p.requirementIds.includes(id)));
      // Judge events and evidence correlate back to the build attempt that produced the code.
      for (const auditPacket of relatedAuditPackets) state.setPacketAttempt(auditPacket.id, packet.attempt);
      const planTimeoutMs = budget.remaining("implementation");
      for (const auditPacket of relatedAuditPackets) {
        if (!results.has(auditPacket.id) && !pendingPlans.has(auditPacket.id)) {
          pendingPlans.set(auditPacket.id, spawnPlanGeneration(auditPacket, auditPacket.id, deps.planner, planCache, planTimeoutMs,
            error => state.record({ at: now(), type: "probe_preplan_failed", packetId: auditPacket.id,
              detail: error instanceof ProbePlannerError
                ? { source: "planner", ...error.diagnostics }
                : { source: "planner", message: errorMessage(error) } })));
        }
      }
      // Every packet is implemented in a fresh session; handoff across packets
      // goes through the project itself (code, tests, ARCHITECTURE.md).
      let result: BuilderResult;
      const implementationDeadline = deps.clock.nowMs() + budget.callTimeout("implementation", IMPLEMENTATION_CALL_CEILING_MS);
      const sessionKey = randomUUID();
      let mayContinue = true;
      result = await build({ mode: "implement", packet, outputDir: options.outputDir,
        platformContract: options.platformContract, projectContext: buildBuilderProjectContext(packet, catalog, implemented) }, "implementation", { sessionKey });
      // A gateway outage must not end the run: keep retrying the same packet
      // with a fresh call window while the failure is retryable; a
      // non-retryable rejection stops dispatch at the check below.
      result = await resumeGatewayWork(result,
        failure => state.record({ at: now(), type: "implementation_paused", packetId: packet.id,
          detail: { requirementIds: packet.requirementIds, failure } }),
        () => build({ mode: "implement", packet, outputDir: options.outputDir,
          platformContract: options.platformContract, projectContext: buildBuilderProjectContext(packet, catalog, implemented) },
        "implementation", { sessionKey }));
      if (result.outcome === "timed_out" && !result.gatewayFailure) {
        mayContinue = false;
        await preserveInterruptedWork(packet);
        const retryTimeoutMs = budget.callTimeout("implementation", IMPLEMENTATION_RETRY_CEILING_MS);
        if (retryTimeoutMs > 0 && !gateway.exhausted) {
          const retryPacket: WorkPacket = { ...packet, attempt: 2 };
          state.setPacketAttempt(packet.id, retryPacket.attempt);
          for (const auditPacket of relatedAuditPackets) state.setPacketAttempt(auditPacket.id, retryPacket.attempt);
          await state.record({ at: now(), type: "implementation_retry", packetId: packet.id,
            detail: { requirementIds: packet.requirementIds, timeoutMs: retryTimeoutMs } });
          result = await build({ mode: "implement", packet: retryPacket, outputDir: options.outputDir,
            platformContract: options.platformContract, projectContext: buildBuilderProjectContext(packet, catalog, implemented) },
          "implementation", { timeoutMs: retryTimeoutMs });
          result = await resumeGatewayWork(result,
            failure => state.record({ at: now(), type: "implementation_paused", packetId: packet.id,
              detail: { requirementIds: packet.requirementIds, failure } }),
            () => build({ mode: "implement", packet: retryPacket, outputDir: options.outputDir,
              platformContract: options.platformContract, projectContext: buildBuilderProjectContext(packet, catalog, implemented) },
            "implementation", { timeoutMs: retryTimeoutMs }));
          if (result.outcome === "timed_out" && !result.gatewayFailure) await preserveInterruptedWork(retryPacket);
        }
        if (result.outcome === "timed_out" && !result.gatewayFailure) {
          state.markRequirements(packet.requirementIds, "blocked");
          await state.record({ at: now(), type: "module_failed", packetId: packet.id,
            detail: { requirementIds: packet.requirementIds, reason: "Builder deadline exhausted; partial work is not a completed implementation" } });
          for (const id of packet.requirementIds) await emitArc(deps, state, arc => arc.requirementState(id, "implement", "failed"));
          continue;
        }
      }
      if (result.gatewayFailure && result.outcome !== "completed") {
        await stopImplementation(packet, result.gatewayFailure);
        break;
      }
      let candidate: CandidateEvidence | undefined;
      let reason = result.outcome === "completed" ? undefined : result.summary || result.outcome;
      if (result.outcome === "completed") {
        try { candidate = await runnable(); }
        catch (error) { reason = errorMessage(error); }
        const remainingMs = Math.min(implementationDeadline - deps.clock.nowMs(), budget.remaining("implementation"));
        if (reason !== undefined && mayContinue && remainingMs > 0 && !gateway.exhausted) {
          const failure = sanitizeDiagnosticText(reason, deps.diagnosticSecrets);
          await state.record({ at: now(), type: "implementation_continued", packetId: packet.id,
            detail: { reason: failure, timeoutMs: remainingMs } });
          result = await build({ mode: "implement", packet, outputDir: options.outputDir,
            platformContract: options.platformContract, projectContext: buildBuilderProjectContext(packet, catalog, implemented) },
          "implementation", { sessionKey, timeoutMs: remainingMs, continuationFeedback: failure });
          result = await resumeGatewayWork(result,
            pause => state.record({ at: now(), type: "implementation_paused", packetId: packet.id,
              detail: { requirementIds: packet.requirementIds, failure: pause } }),
            () => build({ mode: "implement", packet, outputDir: options.outputDir,
              platformContract: options.platformContract, projectContext: buildBuilderProjectContext(packet, catalog, implemented) },
            "implementation", { sessionKey, timeoutMs: remainingMs, continuationFeedback: failure }));
          if (result.gatewayFailure && result.outcome !== "completed") {
            await stopImplementation(packet, result.gatewayFailure);
            break;
          }
          if (result.outcome === "completed") {
            try { candidate = await runnable(); reason = undefined; }
            catch (error) { reason = errorMessage(error); }
          } else reason = result.summary || result.outcome;
        }
      }
      // Initial and continued ordinary failures share the same rescue gate.
      // Timeouts and gateway failures retain their separate recovery semantics.
      if (result.outcome === "failed") {
        await deps.git.captureAccepted(`shallow: attempt ${packet.id}`);
        const receiptFailure = result.summary || result.outcome;
        try {
          if (!await deps.git.hasApplicationChanges(state.snapshot.acceptedSha)) throw new Error("Builder failed without application changes");
          candidate = await runnable(); reason = undefined;
        }
        catch (error) { reason = errorMessage(error); }
        if (reason === undefined) {
          await state.record({ at: now(), type: "module_rescued", packetId: packet.id, detail: { requirementIds: packet.requirementIds, reason: receiptFailure } });
        }
      }
      if (reason !== undefined) {
        if (result.outcome !== "failed") await deps.git.captureAccepted(`shallow: attempt ${packet.id}`);
        await deps.git.restoreAccepted(state.snapshot.acceptedSha);
        state.markRequirements(packet.requirementIds, "blocked");
        await state.record({ at: now(), type: "module_failed", packetId: packet.id, detail: { requirementIds: packet.requirementIds, reason } });
        for (const id of packet.requirementIds) await emitArc(deps, state, arc => arc.requirementState(id, "implement", "failed"));
        continue;
      }
      // Track which audit packets are eligible for module boundary audit.
      for (const p of relatedAuditPackets) {
        if (!pendingModuleAudit.packetIds.includes(p.id)) pendingModuleAudit.packetIds.push(p.id);
      }
      await checkpoint(packet.requirementIds, packet.id, candidate);
      for (const id of packet.requirementIds) {
        implemented.add(id);
        await emitArc(deps, state, arc => arc.requirementState(id, "implement", "completed"));
      }
      previousModuleId = currentModuleId;
    }
    // Final module boundary audit for the last module.
    if (pendingModuleAudit.packetIds.length > 0) {
      await runModuleBoundaryAudit(pendingModuleAudit.packetIds, pendingModuleAudit.moduleId, previousModuleId);
    }

    // Final audit is detection-only: failures are published as-is instead of
    // funneling into a late consolidated repair whose giant packet and full
    // re-audit cost more than they recover.
    await phase("audit");
    results = await audit("audit");
    await publish();

    await phase("delivery");
    await state.record({ at: now(), type: "delivery_started" });
    await deps.candidate?.assertAcceptedInput();
    let finalReport = await runFinalVerifier(options, deps, state);
    let repairedRounds = 0;
    for (let round = 1; !finalReport.ok && round <= MAX_DELIVERY_REPAIR_ROUNDS && !gateway.exhausted && budget.remaining("delivery") > 0; round += 1) {
      repairedRounds = round;
      await state.record({ at: now(), type: "delivery_repair_started", detail: { stage: finalReport.stage, message: finalReport.message, round } });
      const result = await build({ mode: "delivery_repair", outputDir: options.outputDir,
        platformContract: options.platformContract, deliveryFailure: { stage: finalReport.stage,
          expected: expectedByStage[finalReport.stage], actual: sanitizeDiagnosticText(finalReport.message, deps.diagnosticSecrets) } }, "delivery");
      // A repair the Builder did not complete is restored unseen: its verification
      // would be discarded anyway, so spend the remaining rounds on fresh attempts.
      const repaired = result.outcome === "completed" ? await runFinalVerifier(options, deps, state) : finalReport;
      if (result.outcome === "completed" && repaired.ok) {
        await checkpoint([...implemented], "delivery-repair", repaired.candidate);
        // Runtime repair changed the delivered source: old feature passes are not evidence for it.
        results = await audit("delivery");
        await publish();
        finalReport = repaired;
        await state.record({ at: now(), type: "delivery_repair_accepted" });
        break;
      }
      await deps.git.restoreAccepted(state.snapshot.acceptedSha);
      await state.record({ at: now(), type: "delivery_repair_restored", detail: { round } });
    }
    if (!finalReport.ok && repairedRounds > 0) {
      // All attempted rounds failed and were restored; confirm the accepted state
      // once so the final report describes the delivered candidate, not a rejected attempt.
      finalReport = await runFinalVerifier(options, deps, state);
    }
    await deps.candidate?.assertAcceptedInput();
    if (finalReport.ok && finalReport.candidate) await deps.candidate?.assertCurrent(finalReport.candidate);
    await state.record({ at: now(), type: "delivery_finished", detail: finalReport });
    const statuses = state.snapshot.statusByRequirementId;
    const ids = (status: typeof statuses[string]) => catalog.requirements.filter(item => statuses[item.id] === status).map(item => item.id);
    const verifiedRequirementIds = ids("verified");
    const summary: RunSummary = { status: !finalReport.ok ? "failed" : verifiedRequirementIds.length === catalog.requirements.length ? "delivered" : "partial",
      acceptedSha: state.snapshot.acceptedSha, implementedRequirementIds: [...implemented], verifiedRequirementIds,
      blockedRequirementIds: ids("blocked"), failedRequirementIds: ids("failed"), inconclusiveRequirementIds: ids("inconclusive"), pendingRequirementIds: ids("todo") };
    await state.record({ at: now(), type: "pipeline_finished", detail: { ...summary, pendingRequirementIds: ids("todo"), memory: await memorySnapshot() } });
    await emitFolderRollup();
    await emitArc(deps, state, arc => arc.runnerState(finalReport.ok ? "completed" : "failed", `summary ${summary.status}`));
    return summary;
  } catch (error) {
    // An uncontained writer must never race a checkout. Stop the run for host cleanup.
    if (!(error instanceof ExecutionFault && error.code === "builder_cleanup")) await deps.git.restoreAccepted(state.snapshot.acceptedSha);
    await state.record({ at: now(), type: "pipeline_failed", detail: { message: errorMessage(error) } });
    await emitFolderRollup();
    await emitArc(deps, state, arc => arc.runnerState("failed", sanitizeDiagnosticText(errorMessage(error), deps.diagnosticSecrets)));
    throw error;
  } finally {
    try { await deps.builder.close(); }
    finally { await Promise.allSettled(pendingPlans.values()); }
  }
}

function buildBuilderProjectContext(
  packet: WorkPacket,
  catalog: RequirementCatalog,
  implemented: ReadonlySet<string>,
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
      .filter((item) => dependencyIds.has(item.id) && implemented.has(item.id))
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
  readiness: "应用使用随机端口启动且健康检查返回成功；只设置 PORT 时额外端口也必须绑定，未知路径必须返回响应且进程不退出",
  browser: "根页面可访问并显示主要内容区域",
  complete: "完整交付验证成功",
} satisfies Record<FinalVerificationReport["stage"], string>;

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
        const retry = error.retryable && retryCount === 0;
        await state.record({ at: now(), type: "execution_fault", packetId: "final-verification",
          detail: { source: error.source, code: error.code, retryable: error.retryable, retry, retryCount } });
        if (retry) continue;
        throw error;
      }
      return { ok: false, stage: "readiness", message: errorMessage(error) };
    }
  }
}


function now(): string { return new Date().toISOString(); }

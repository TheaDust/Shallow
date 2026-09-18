import { dirname } from "node:path";

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
import type { ProbePlanner } from "./judge/llm-probe-planner.js";
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
import type { CandidateRuntime } from "./candidate-runtime.js";
import type { CandidateEvidence } from "./types.js";
import type {
  PlatformContract,
  RequirementCatalog,
  WorkPacket,
} from "./types.js";

const BOUNDARY_REPAIR_CALL_CEILING_MS = 1_800_000;
const FINAL_REPAIR_CALL_CEILING_MS = 3_600_000;

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
  const planCache = new PlanCache(dirname(options.ledgerFile),
    options.progressDir ? progressPlansDirectory(options.progressDir) : undefined);
  let results = new Map<string, AuditResult>();
  let repairCount = 0;
  let boundaryRepairCount = 0;
  let currentBoundaryModule: string | undefined;
  deps.candidate?.setRecorder(event => state.record(event));

  const phase = async (name: PipelinePhase, round?: number): Promise<void> => {
    const remaining = budget.remaining(name);
    await state.record({ at: now(), type: "phase_started", detail: { phase: name, round,
      memory: await memorySnapshot(),
      ...(Number.isFinite(remaining) ? { remainingMs: remaining } : {}) } });
  };
  const build = async (request: BuilderRequest, name: PipelinePhase, runOptions: BuilderRunOptions = {}): Promise<BuilderResult> => {
    const packetId = "packet" in request ? request.packet.id : "delivery-repair";
    const ceiling = name === "implementation" ? (options.totalBudgetMs > 0 ? 600_000 : 3_600_000) : name === "repair" ? FINAL_REPAIR_CALL_CEILING_MS : 120_000;
    const timeoutMs = budget.callTimeout(name, Math.min(ceiling, runOptions.timeoutMs ?? ceiling));
    if (timeoutMs <= 0) return { outcome: "timed_out", sessionId: "unavailable", summary: "phase budget exhausted" };
    state.setPacketAttempt(packetId, "packet" in request ? request.packet.attempt : 1);
    await state.record({ at: now(), type: "builder_started", packetId, detail: { mode: request.mode } });
    const at = deps.clock.nowMs();
    let result: BuilderResult;
    try { result = await deps.builder.run(request, { timeoutMs, sessionKey: runOptions.sessionKey }); }
    catch (error) {
      if (error instanceof ExecutionFault) throw error;
      result = { outcome: "failed", sessionId: "unavailable", summary: errorMessage(error) };
    }
    await state.record({ at: now(), type: "builder_finished", packetId,
      detail: { ...result, durationMs: Math.max(0, deps.clock.nowMs() - at) } });
    if (result.referenceImages) await state.record({ at: now(), type: "builder_reference_images", packetId, detail: result.referenceImages });
    return result;
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
  const audit = async (name: PipelinePhase, previous = results): Promise<Map<string, AuditResult>> => {
    const audited = new Map<string, AuditResult>();
    // Previously passed paths are checked first after edits, so regressions stop repairs early.
    const ordered = [...packets].sort((a, b) => Number(previous.get(b.id)?.status === "verified") - Number(previous.get(a.id)?.status === "verified"));
    for (const packet of ordered) {
      if (!packet.requirementIds.every(id => implemented.has(id))) continue;
      const cached = previous.get(packet.id)?.plan ?? await planCache.read(packet);
      const result = budget.remaining(name) <= 0
        ? { status: "inconclusive" as const, plan: cached, reason: "audit phase budget exhausted" }
        : await auditPacket(packet, cached, options, deps, state, () => budget.remaining(name));
      // Persist refined plans so future audits skip the LLM call.
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
      const failures = targetPackets.filter(p => results.get(p.id)?.status === "failed");
      if (!failures.length) break;
      const round = ++boundaryRepairCount;
      for (const item of failures) state.setPacketAttempt(item.id, round + 1);
      await phase("repair", round);
      const repairPacket = makePacket(`repair-round-${round}`, failures.flatMap(item => item.requirements), round === 1 ? 2 : 3);
      const reports = failures.map(item => results.get(item.id)!.report!);
      const observation = toBuilderShadowObservation({ packetId: repairPacket.id, verdict: "fail", passedCases: [],
        failures: reports.flatMap(report => report.failures) }, deps.diagnosticSecrets);
      await state.record({ at: now(), type: "repair_batch_started", detail: { round, requirementIds: repairPacket.requirementIds } });
      const repairTimeoutMs = Math.max(1, Math.floor(Math.min(BOUNDARY_REPAIR_CALL_CEILING_MS, budget.remaining("repair") / 2)));
      const repairResult = await build({ mode: "repair", packet: repairPacket, projectContext: buildBuilderProjectContext(repairPacket, catalog, implemented),
        outputDir: options.outputDir, platformContract: options.platformContract, shadowObservation: observation },
        "repair", { timeoutMs: repairTimeoutMs });
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
        for (const packet of targetPackets) {
          if (results.get(packet.id)?.status !== "verified") continue;
          if (budget.remaining("repair") <= 0) { regressed = true; break; }
          const cachedPlan = results.get(packet.id)?.plan ?? await planCache.read(packet);
          const recheck = await auditPacket(packet, cachedPlan, options, deps, state, () => budget.remaining("repair"));
          if (recheck.status !== "verified") { regressed = true; break; }
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
      await emitArc(deps, state, arc => arc.requirementState(folderId, "implement", implementedLeaves.length ? "completed" : "failed"));
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
      if (budget.remaining("implementation") <= 0) break;
      const currentModuleId = packet.requirements[0]?.folderPath[1] ?? packet.requirements[0]?.id;
      // Module boundary: run full audit on the previous module before starting the next one.
      if (previousModuleId !== undefined && currentModuleId !== previousModuleId && pendingModuleAudit.packetIds.length > 0) {
        await runModuleBoundaryAudit(pendingModuleAudit.packetIds, pendingModuleAudit.moduleId, previousModuleId);
        pendingModuleAudit.packetIds = [];
      }
      pendingModuleAudit.moduleId = currentModuleId;
      await state.record({ at: now(), type: "packet_selected", packetId: packet.id,
        detail: { requirementIds: packet.requirementIds, names: packet.requirements.map(item => item.name) } });
      for (const id of packet.requirementIds) {
        // Design is folded into the implementation turn; keep the platform's phase trace complete.
        await emitArc(deps, state, arc => arc.requirementState(id, "design", "running"));
        await emitArc(deps, state, arc => arc.requirementState(id, "design", "completed"));
        await emitArc(deps, state, arc => arc.requirementState(id, "implement", "running"));
      }
      // Spawn plan generation in parallel with Builder execution.
      // The corresponding audit packets get their plans pre-computed.
      const relatedAuditPackets = packets.filter(p => packet.requirementIds.some(id => p.requirementIds.includes(id)));
      // Judge events and evidence correlate back to the build attempt that produced the code.
      for (const auditPacket of relatedAuditPackets) state.setPacketAttempt(auditPacket.id, packet.attempt);
      const planTimeoutMs = budget.callTimeout("implementation", 180_000);
      const planPromises = relatedAuditPackets
        .filter(p => !results.has(p.id))
        .map(p => spawnPlanGeneration(p, p.id, deps.planner, planCache, planTimeoutMs));
      // Every packet is implemented in a fresh session; handoff across packets
      // goes through the project itself (code, tests, ARCHITECTURE.md).
      const result = await build({ mode: "implement", packet, outputDir: options.outputDir,
        platformContract: options.platformContract, projectContext: buildBuilderProjectContext(packet, catalog, implemented) }, "implementation");
      // Plans are generated in the background; await them here to ensure they are persisted.
      await Promise.allSettled(planPromises);
      let candidate: CandidateEvidence | undefined;
      let reason = result.outcome === "completed" ? undefined : result.summary || result.outcome;
      if (reason !== undefined) {
        // Save the attempt first, then check what actually runs: a missing
        // receipt must not discard runnable code.
        await deps.git.captureAccepted(`shallow: attempt ${packet.id}`);
        const receiptFailure = reason;
        try { candidate = await runnable(); reason = undefined; }
        catch (error) { reason = errorMessage(error); }
        if (reason === undefined) {
          await state.record({ at: now(), type: "module_rescued", packetId: packet.id, detail: { requirementIds: packet.requirementIds, reason: receiptFailure } });
        } else {
          await deps.git.restoreAccepted(state.snapshot.acceptedSha);
          state.markRequirements(packet.requirementIds, "blocked");
          await state.record({ at: now(), type: "module_failed", packetId: packet.id, detail: { requirementIds: packet.requirementIds, reason } });
          for (const id of packet.requirementIds) await emitArc(deps, state, arc => arc.requirementState(id, "implement", "failed"));
          continue;
        }
      } else {
        try { candidate = await runnable(); }
        catch (error) { reason = errorMessage(error); }
        if (reason !== undefined) {
          await deps.git.captureAccepted(`shallow: attempt ${packet.id}`);
          await deps.git.restoreAccepted(state.snapshot.acceptedSha);
          state.markRequirements(packet.requirementIds, "blocked");
          await state.record({ at: now(), type: "module_failed", packetId: packet.id, detail: { requirementIds: packet.requirementIds, reason } });
          for (const id of packet.requirementIds) await emitArc(deps, state, arc => arc.requirementState(id, "implement", "failed"));
          continue;
        }
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

    await phase("audit");
    results = await audit("audit");
    await publish();
    while (repairCount < 2 && budget.remaining("repair") > 0) {
      const failures = packets.filter(packet => results.get(packet.id)?.status === "failed");
      if (!failures.length) break;
      const round = ++repairCount;
      for (const item of failures) state.setPacketAttempt(item.id, round + 1);
      await phase("repair", round);
      const packet = makePacket(`repair-round-${round}`, failures.flatMap(item => item.requirements), round === 1 ? 2 : 3);
      const reports = failures.map(item => results.get(item.id)!.report!);
      const observation = toBuilderShadowObservation({ packetId: packet.id, verdict: "fail", passedCases: [],
        failures: reports.flatMap(report => report.failures) }, deps.diagnosticSecrets);
      await state.record({ at: now(), type: "repair_batch_started", detail: { round, requirementIds: packet.requirementIds } });
      // Leave at least half the remaining repair phase for independent regression checks.
      const repairTimeoutMs = Math.max(1, Math.floor(Math.min(FINAL_REPAIR_CALL_CEILING_MS, budget.remaining("repair") / 2)));
      const result = await build({ mode: "repair", packet, projectContext: buildBuilderProjectContext(packet, catalog, implemented),
        outputDir: options.outputDir, platformContract: options.platformContract, shadowObservation: observation },
        "repair", { timeoutMs: repairTimeoutMs });
      let reason = result.outcome === "completed" ? "" : result.summary || result.outcome;
      let candidate: CandidateEvidence | undefined;
      if (!reason) {
        try { candidate = await runnable(); } catch (error) { reason = errorMessage(error); }
      }
      let next = results;
      if (!reason) {
        next = await audit("repair");
        const regressed = [...results].some(([id, prior]) => prior.status === "verified" && next.get(id)?.status !== "verified");
        const improved = failures.some(item => next.get(item.id)?.status === "verified");
        if (regressed) reason = "previously verified behavior was lost or could not be reverified";
        else if (!improved) reason = "repair produced no independently verified improvement";
      }
      if (reason) {
        await deps.git.restoreAccepted(state.snapshot.acceptedSha);
        await state.record({ at: now(), type: "repair_batch_finished", detail: { round, retained: false, reason } });
        break;
      }
      await checkpoint(packet.requirementIds, packet.id, candidate);
      results = next;
      await publish();
      await state.record({ at: now(), type: "repair_batch_finished", detail: { round, retained: true, reason: "verified improvement with regression coverage" } });
    }

    await phase("delivery");
    await state.record({ at: now(), type: "delivery_started" });
    await deps.candidate?.assertAcceptedInput();
    let finalReport = await runFinalVerifier(options, deps, state);
    if (!finalReport.ok && budget.remaining("delivery") > 0) {
      await state.record({ at: now(), type: "delivery_repair_started", detail: { stage: finalReport.stage, message: finalReport.message, round: 1 } });
      const result = await build({ mode: "delivery_repair", outputDir: options.outputDir,
        platformContract: options.platformContract, deliveryFailure: { stage: finalReport.stage,
          expected: expectedByStage[finalReport.stage], actual: sanitizeDiagnosticText(finalReport.message, deps.diagnosticSecrets) } }, "delivery");
      const repaired = await runFinalVerifier(options, deps, state);
      if (result.outcome === "completed" && repaired.ok) {
        await checkpoint([...implemented], "delivery-repair", repaired.candidate);
        // Runtime repair changed the delivered source: old feature passes are not evidence for it.
        results = await audit("delivery");
        await publish();
        finalReport = repaired;
        await state.record({ at: now(), type: "delivery_repair_accepted" });
      } else {
        await deps.git.restoreAccepted(state.snapshot.acceptedSha);
        await state.record({ at: now(), type: "delivery_repair_restored", detail: { round: 1 } });
        finalReport = await runFinalVerifier(options, deps, state);
      }
    }
    await deps.candidate?.assertAcceptedInput();
    if (finalReport.ok && finalReport.candidate) await deps.candidate?.assertCurrent(finalReport.candidate);
    await state.record({ at: now(), type: "delivery_finished", detail: finalReport });
    const statuses = state.snapshot.statusByRequirementId;
    const ids = (status: typeof statuses[string]) => catalog.requirements.filter(item => statuses[item.id] === status).map(item => item.id);
    const verifiedRequirementIds = ids("verified");
    const summary: RunSummary = { status: !finalReport.ok ? "failed" : verifiedRequirementIds.length === catalog.requirements.length ? "delivered" : "partial",
      acceptedSha: state.snapshot.acceptedSha, implementedRequirementIds: [...implemented], verifiedRequirementIds,
      blockedRequirementIds: ids("blocked"), failedRequirementIds: ids("failed"), inconclusiveRequirementIds: ids("inconclusive") };
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
    await deps.builder.close();
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

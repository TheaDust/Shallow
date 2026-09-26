import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { ExecutionFault } from "../src/execution-fault.js";
import { ProbePlannerError } from "../src/judge/llm-probe-planner.js";
import { PlaywrightProbeRunner } from "../src/judge/playwright-probe-runner.js";
import { GitCliOps } from "../src/git-ops.js";
import { FakeBuilder } from "./fakes/fake-builder.js";
import { startFixtureServer } from "./helpers/fixture-server.js";
import { withModulePipeline, fail, pass, testPlan } from "./helpers/module-pipeline.js";

test("Pipeline checks module paths before the full atomic audit and keeps verification separate", async () => {
  await withModulePipeline(async f => {
    const calls: string[] = [];
    f.deps.planner.plan = async (packet, _feedback, _options) => {
      calls.push(packet.id);
      const { testPlan } = await import("./helpers/module-pipeline.js");
      return testPlan(packet);
    };
    const summary = await f.run();
    assert.equal(summary.status, "delivered");
    assert.deepEqual(f.builder.requests.map(item => "packet" in item ? item.packet.requirementIds : []), [["A", "B"], ["C"]]);
    // Parallel plan generation runs during implementation; module boundary audit reads from cache (no additional planner calls).
    // Consolidated audit also reads from cache.
    assert.deepEqual(calls, ["packet-a", "packet-b", "packet-c"]);
    assert.deepEqual(summary.implementedRequirementIds, ["A", "B", "C"]);
    assert.deepEqual(summary.verifiedRequirementIds, ["A", "B", "C"]);
    assert.deepEqual(f.git.restoredShas, []);
    // Every implementation packet runs in a fresh session.
    assert.ok(f.builder.runOptions[0]?.sessionKey);
    assert.notEqual(f.builder.runOptions[0]?.sessionKey, f.builder.runOptions[1]?.sessionKey);
    assert.equal(f.builder.closeCount, 1);
    const events = await f.events();
    assert.equal(events.filter(item => item.type === "checkpoint_saved").length, 2);
    // 3 consolidated audit_result events (module boundary audit updates results internally, no separate events).
    assert.equal(events.filter(item => item.type === "audit_result").length, 3);
    assert.ok(events.some(item => item.type === "module_boundary_audit_finished"));
  });
});

for (const fault of ["schema", "auth", "locator", "browser"] as const) {
  test(`Judge ${fault} fault retains implemented features and does not request application repair`, async () => {
    await withModulePipeline(async f => {
      if (fault === "schema" || fault === "auth") f.deps.planner.plan = async () => {
        throw new ProbePlannerError(fault === "schema" ? "schema" : "transport", "judge failed", { httpStatus: fault === "auth" ? 401 : undefined });
      };
      else f.deps.runner.run = async plan => {
        if (fault === "browser") throw new ExecutionFault("browser", "browser_disconnected", true);
        return fail(plan, "locator");
      };
      const summary = await f.run();
      assert.equal(summary.status, "partial");
      assert.deepEqual(summary.inconclusiveRequirementIds, ["A", "B"]);
      assert.deepEqual(summary.blockedRequirementIds, ["C"]);
      assert.deepEqual(f.git.restoredShas, []);
      assert.equal(summary.acceptedSha, "first");
      assert.equal(f.builder.requests.length, 1);
      const gate = (await f.events()).find(item => item.type === "dependency_gate_blocked");
      assert.deepEqual(gate?.detail?.unmetDependencyIds, ["A", "B"]);
    });
  });
}

test("Audit replays a business failure in a fresh application before requesting consolidated repair", async () => {
  await withModulePipeline(async f => {
    const calls = new Map<string, number>();
    f.deps.runner.run = async plan => {
      if (plan.packetId.startsWith("feedback-")) return pass(plan);
      calls.set(plan.packetId, (calls.get(plan.packetId) ?? 0) + 1);
      const repairing = f.builder.requests.some(item => item.mode === "repair");
      return !repairing && plan.packetId !== "packet-c" ? fail(plan) : pass(plan);
    };
    const summary = await f.run();
    const repair = f.builder.requests.find(item => item.mode === "repair");
    assert.ok(repair && repair.mode === "repair");
    assert.deepEqual(repair.packet.requirementIds, ["A", "B"]);
    assert.equal(repair.shadowObservation.failures.length, 2);
    assert.equal(f.builder.runOptions[f.builder.requests.findIndex(item => item.mode === "repair")]?.sessionKey, undefined);
    // Module boundary audit adds an extra probe round before consolidated.
    assert.equal(calls.get("packet-a"), 4);
    assert.equal(calls.get("packet-b"), 4);
    assert.equal(calls.get("packet-c"), 2);
    assert.equal(summary.status, "delivered");
  });
});

test("A non-reproducible foundation failure blocks downstream until it is independently verified", async () => {
  await withModulePipeline(async f => {
    const seen = new Set<string>();
    f.deps.runner.run = async plan => { if (seen.has(plan.packetId)) return pass(plan); seen.add(plan.packetId); return fail(plan); };
    const summary = await f.run();
    // The final detection pass can verify the retained foundation, but it is too
    // late to spend a Builder call on a dependency that was uncertain at its gate.
    assert.deepEqual(summary.verifiedRequirementIds, ["A", "B"]);
    assert.deepEqual(summary.blockedRequirementIds, ["C"]);
    assert.equal(f.builder.requests.length, 1);
    assert.deepEqual(f.git.restoredShas, []);
  });
});

for (const regression of [true, false]) {
  test(`Unhelpful repair restores the runnable checkpoint: regression=${regression}`, async () => {
    await withModulePipeline(async f => {
      f.deps.runner.run = async plan => {
        const repairing = f.builder.requests.some(item => item.mode === "repair");
        const failed = plan.packetId === "packet-a" ? !(repairing && regression) : repairing && regression;
        return failed ? fail(plan) : pass(plan);
      };
      const summary = await f.run();
      // Module boundary audit uses the repair rounds on the first module;
      // the final audit is detection-only and never launches more repairs.
      if (regression) {
        // Boundary repair causes regression in packet-b; transitive dependency A
        // was not verified at the gate, so C is never implemented.
        assert.deepEqual(summary.verifiedRequirementIds, ["A"]);
        assert.deepEqual(summary.failedRequirementIds, ["B"]);
        assert.deepEqual(summary.blockedRequirementIds, ["C"]);
        assert.equal(summary.status, "partial");
      } else {
        // packet-a always fails regardless of repair state.
        assert.deepEqual(summary.verifiedRequirementIds, ["B"]);
        assert.deepEqual(summary.failedRequirementIds, ["A"]);
        assert.deepEqual(summary.blockedRequirementIds, ["C"]);
        assert.equal(summary.status, "partial");
      }
    });
  });
}

test("A module boundary repair that breaks a verified path is discarded instead of kept", async () => {
  await withModulePipeline(async f => {
    f.deps.runner.run = async plan => {
      if (plan.packetId === "packet-c") return pass(plan);
      const repairing = f.builder.requests.some(item => item.mode === "repair");
      const target = plan.packetId === "packet-a";
      // The repair fixes A but regresses the verified B.
      return repairing === target ? pass(plan) : fail(plan);
    };
    const summary = await f.run();
    const events = await f.events();
    const batches = events.filter(item => item.type === "repair_batch_finished");
    assert.equal(batches[0]?.detail?.retained, false);
    assert.match(String(batches[0]?.detail?.reason), /previously verified behavior was lost/);
    // The regressing boundary repair is never checkpointed, and the dependent
    // module is not built on the unresolved foundation.
    assert.equal(events.filter(item => item.type === "checkpoint_saved").length, 1);
    assert.deepEqual(summary.verifiedRequirementIds, ["A"]);
    assert.deepEqual(summary.failedRequirementIds, ["B"]);
    assert.deepEqual(summary.blockedRequirementIds, ["C"]);
    assert.equal(summary.status, "partial");
  });
});

test("A boundary repair that drifts a verified packet's locators keeps the refined plan for the final audit", async () => {
  await withModulePipeline(async f => {
    const refined: string[] = [];
    f.deps.planner.refineLocators = async original => {
      refined.push(original.packetId);
      return {
        ...structuredClone(original),
        cases: original.cases.map(item => ({
          ...item,
          steps: item.steps.map(step => "locator" in step && step.locator.by === "role" && step.locator.name === undefined
            ? { ...step, locator: { ...step.locator, name: "Workspace" } }
            : step),
        })),
      };
    };
    f.deps.runner.run = async plan => {
      if (plan.packetId === "packet-c") return pass(plan);
      const repaired = f.builder.requests.some(item => item.mode === "repair");
      if (plan.packetId === "packet-a") return repaired ? pass(plan) : fail(plan);
      // packet-b: the plain locator resolves before the repair; the repair renames
      // the control, so afterwards only the refined (named) locator resolves.
      const step = plan.cases[0].steps[1];
      const named = "locator" in step && step.locator.by === "role" && step.locator.name !== undefined;
      return repaired === named ? pass(plan) : fail(plan, named ? "assertion" : "locator");
    };
    const summary = await f.run();
    // The verified packet's recheck needed a locator refinement to survive the repair.
    assert.deepEqual(refined, ["packet-b"]);
    // Detection-only final audits cannot refine again, so the refined plan must have
    // been kept: B stays verified instead of dropping to inconclusive.
    assert.deepEqual(summary.verifiedRequirementIds, ["A", "B", "C"]);
    assert.equal(summary.status, "delivered");
  });
});

test("Judge events carry the build attempt that produced the audited code", async () => {
  await withModulePipeline(async f => {
    const summary = await f.run();
    assert.equal(summary.status, "delivered");
    const judge = (await f.events()).filter(item => item.type === "probe_started" || item.type === "probe_finished");
    assert.ok(judge.length > 0);
    assert.ok(judge.every(item => item.attempt === 1));
  });
});

test("Per-module boundary repair quota: each module gets independent repair rounds", async () => {
  await withModulePipeline(async f => {
    f.options.totalBudgetMs = 0;
    // Track repair attempts per packet to verify quota resets per module.
    const repairAttempts = new Map<string, number>();
    f.deps.runner.run = async plan => {
      if (plan.packetId.startsWith("feedback-")) return pass(plan);
      // Count repair attempts for each packet.
      const key = plan.packetId;
      const count = (repairAttempts.get(key) ?? 0) + 1;
      repairAttempts.set(key, count);
      const repairCount = f.builder.requests.filter(request => request.mode === "repair").length;
      // FIRST becomes sound after its repair. SECOND then fails independently
      // until its own repair proves the per-module quota reset.
      return plan.packetId === "packet-c"
        ? repairCount >= 2 ? pass(plan) : fail(plan)
        : repairCount >= 1 ? pass(plan) : fail(plan);
    };
    const summary = await f.run();
    const repairs = f.builder.requests.filter(r => r.mode === "repair");
    // FIRST module and SECOND module each consume one independent repair.
    // Final audit only re-checks; it launches no repairs of its own.
    // Total: 2 implement + 1 FIRST repair + 1 SECOND repair = 4 requests
    assert.equal(repairs.length, 2);
    assert.equal(f.builder.requests.length, 4);
    // All requirements verified after per-module boundary repairs.
    assert.deepEqual(summary.verifiedRequirementIds, ["A", "B", "C"]);
    assert.deepEqual(summary.failedRequirementIds, []);
    // Verify that A and B got repair attempts in FIRST module,
    // and C got repair attempts in SECOND module (proving quota reset).
    assert.ok((repairAttempts.get("packet-a") ?? 0) >= 3);
    assert.ok((repairAttempts.get("packet-b") ?? 0) >= 3);
    assert.ok((repairAttempts.get("packet-c") ?? 0) >= 3);
  });
});

test("Broken foundation startup blocks its dependent packet without opening a new session", async () => {
  await withModulePipeline(async f => {
    let starts = 0;
    f.deps.appLifecycle.start = async () => {
      if (++starts <= 2) throw new Error("broken build");
      return { baseUrl: f.options.platformContract.baseUrl, stop: async () => {} };
    };
    const summary = await f.run();
    assert.deepEqual(summary.blockedRequirementIds, ["A", "B", "C"]);
    assert.deepEqual(summary.verifiedRequirementIds, []);
    assert.deepEqual(f.git.restoredShas, ["initial"]);
    assert.equal(f.builder.runOptions[0]?.sessionKey, f.builder.runOptions[1]?.sessionKey);
    assert.equal(f.builder.runOptions.length, 2);
  });
});

test("A failed Builder receipt is rescued when the written application is runnable", async () => {
  await withModulePipeline(async f => {
    const builder = new FakeBuilder(["failed", "completed"]);
    f.deps.builder = builder;
    const summary = await f.run();
    assert.deepEqual(summary.blockedRequirementIds, []);
    assert.deepEqual(summary.implementedRequirementIds, ["A", "B", "C"]);
    assert.deepEqual(summary.verifiedRequirementIds, ["A", "B", "C"]);
    assert.deepEqual(f.git.restoredShas, []);
    // initial + attempt snapshot for the rescued packet + two checkpoints.
    assert.equal(f.git.captureMessages.length, 4);
    // Implementation packets always run in fresh sessions.
    assert.ok(builder.runOptions[0]?.sessionKey);
    assert.notEqual(builder.runOptions[0]?.sessionKey, builder.runOptions[1]?.sessionKey);
    const events = await f.events();
    const rescued = events.filter(item => item.type === "module_rescued");
    assert.equal(rescued.length, 1);
    assert.deepEqual(rescued[0].detail?.requirementIds, ["A", "B"]);
  });
});

test("A failed Builder receipt with unrunnable code stays blocked and restores the checkpoint", async () => {
  await withModulePipeline(async f => {
    f.deps.builder = new FakeBuilder(["failed", "completed"]);
    let starts = 0;
    f.deps.appLifecycle.start = async () => {
      if (++starts === 1) throw new Error("broken build");
      return { baseUrl: f.options.platformContract.baseUrl, stop: async () => {} };
    };
    const summary = await f.run();
    assert.deepEqual(summary.blockedRequirementIds, ["A", "B", "C"]);
    assert.deepEqual(summary.implementedRequirementIds, []);
    assert.deepEqual(f.git.restoredShas, ["initial"]);
  });
});

test("Implementation phase reserves time for audit and delivery instead of starting more modules", async () => {
  await withModulePipeline(async f => {
    let time = 0;
    f.deps.clock = { nowMs: () => time };
    const start = f.deps.appLifecycle.start;
    f.deps.appLifecycle.start = async (...args) => { time = 36_001; return start(...args); };
    const summary = await f.run();
    assert.equal(f.builder.requests.length, 1);
    assert.equal(f.builder.runOptions[0]?.timeoutMs, 36_000);
    assert.deepEqual(summary.verifiedRequirementIds, ["A", "B"]);
    assert.equal(summary.status, "partial");
  });
});

test("Expired audit does not call Planner and preserves unverified code", async () => {
  await withModulePipeline(async f => {
    let time = 0;
    f.deps.clock = { nowMs: () => time };
    f.deps.appLifecycle.start = async () => { time = 50_000; return { baseUrl: f.options.platformContract.baseUrl, stop: async () => {} }; };
    f.deps.planner.plan = async () => { assert.fail("Planner must not run after audit deadline"); };
    const summary = await f.run();
    assert.deepEqual(summary.inconclusiveRequirementIds, ["A", "B"]);
    assert.deepEqual(f.git.restoredShas, []);
  });
});

test("Delivery repair has one attempt and invalidates stale feature passes when source changes", async () => {
  await withModulePipeline(async f => {
    let time = 0;
    f.deps.clock = { nowMs: () => time };
    let checks = 0;
    f.deps.finalVerifier.verify = async () => {
      checks++;
      if (checks === 1) return { ok: false, stage: "build", message: "broken" };
      time = 60_001;
      return { ok: true, stage: "complete", message: "repaired" };
    };
    const summary = await f.run();
    assert.equal(f.builder.requests.filter(item => item.mode === "delivery_repair").length, 1);
    assert.deepEqual(summary.verifiedRequirementIds, []);
    assert.deepEqual(summary.inconclusiveRequirementIds, ["A", "B", "C"]);
    assert.equal(summary.status, "partial");
  });
});

test("A failed delivery repair attempt is not verified; the next round can still succeed", async () => {
  await withModulePipeline(async f => {
    const builder = new FakeBuilder(["completed", "completed", "failed", "completed"]);
    f.deps.builder = builder;
    let checks = 0;
    f.deps.finalVerifier.verify = async () => {
      checks++;
      return checks === 1 ? { ok: false, stage: "build", message: "broken" } : { ok: true, stage: "complete", message: "repaired" };
    };
    const summary = await f.run();
    assert.equal(builder.requests.filter(item => item.mode === "delivery_repair").length, 2);
    // Verification covers the initial failure and the completed round only: a repair
    // the Builder did not complete is restored without wasting a verification on it.
    assert.equal(checks, 2);
    assert.equal(summary.status, "delivered");
  });
});

test("Unlimited delivery stops after three repair rounds and one browser infrastructure retry", async () => {
  await withModulePipeline(async f => {
    f.options.totalBudgetMs = 0;
    let checks = 0;
    f.deps.finalVerifier.verify = async () => { checks++; return { ok: false, stage: "build", message: "broken" }; };
    assert.equal((await f.run()).status, "failed");
    // Initial verification, one per completed repair round, one post-restore confirmation.
    assert.equal(checks, 5);
    const repairs = f.builder.requests.filter(item => item.mode === "delivery_repair");
    assert.equal(repairs.length, 3);
    // Each delivery repair call may take up to the 30-minute ceiling.
    const firstRepair = f.builder.requests.findIndex(item => item.mode === "delivery_repair");
    assert.equal(f.builder.runOptions[firstRepair]?.timeoutMs, 1_800_000);
    // Every failed round restores the accepted state before the next attempt.
    assert.deepEqual(f.git.restoredShas, ["second", "second", "second"]);
  });
  await withModulePipeline(async f => {
    f.options.totalBudgetMs = 0;
    let checks = 0;
    f.deps.finalVerifier.verify = async () => { checks++; throw new ExecutionFault("browser", "browser_disconnected", true); };
    await assert.rejects(f.run(), ExecutionFault);
    assert.equal(checks, 2);
    assert.equal(f.builder.closeCount, 1);
    assert.deepEqual(f.git.restoredShas, ["second"]);
  });
});

for (const result of ["improved", "unchanged", "regressed"] as const) {
  test(`Boundary diagnosis of a missing declared action retains only verified improvements: ${result}`, async () => {
    await withModulePipeline(async f => {
      const catalog = JSON.parse(await readFile(f.options.requirementsFile, "utf8"));
      catalog.children[0].children[0].description = 'Open "Items" and click "Publish".';
      await writeFile(f.options.requirementsFile, JSON.stringify(catalog));
      f.deps.planner.plan = async packet => {
        const plan = testPlan(packet);
        if (packet.id === "packet-a") plan.cases[0].steps.splice(1, 0,
          { op: "click", locator: { by: "role", role: "button", name: "Items" } },
          { op: "click", locator: { by: "role", role: "button", name: "Publish" } });
        return plan;
      };
      f.deps.runner.run = async plan => {
        const repaired = f.builder.requests.some(request => request.mode === "repair");
        if (plan.packetId === "packet-b" && repaired && result === "regressed") return fail(plan);
        if (plan.packetId !== "packet-a" || (repaired && result !== "unchanged")) return pass(plan);
        const report = fail(plan, "locator");
        report.failures[0].stepIndex = 2;
        return report;
      };
      const summary = await f.run();
      const repairs = f.builder.requests.filter(request => request.mode === "repair");
      assert.equal(repairs.length, 1);
      const repair = repairs[0];
      assert.ok(repair.mode === "repair");
      assert.deepEqual(repair.packet.requirementIds, ["A"]);
      assert.equal(repair.shadowObservation.failures[0].category, "locator");
      const event = (await f.events()).find(event => event.type === "repair_batch_finished");
      assert.ok(event?.type === "repair_batch_finished");
      assert.equal(event.detail?.retained, result === "improved");
      assert.equal(f.git.restoredShas.length, result === "improved" ? 0 : 1);
      if (result === "improved") assert.equal(summary.status, "delivered");
      if (result === "unchanged") assert.ok(summary.inconclusiveRequirementIds?.includes("A"));
    });
  });
}

test("Real Chromium verifies the fixture after all module builds", async () => {
  await withModulePipeline(async f => {
    f.deps.runner = new PlaywrightProbeRunner();
    f.deps.appLifecycle.start = async outputDir => {
      const server = await startFixtureServer(outputDir);
      return { baseUrl: server.baseUrl, stop: server.stop };
    };
    assert.equal((await f.run()).status, "delivered");
  });
});

test("Real Git retains application files when Planner fails", async () => {
  await withModulePipeline(async f => {
    f.deps.git = await GitCliOps.open(f.options.outputDir);
    f.deps.planner.plan = async () => { throw new Error("invalid plan"); };
    const summary = await f.run();
    assert.equal(summary.status, "partial");
    assert.match(await readFile(join(f.options.outputDir, "server.mjs"), "utf8"), /createServer/);
  });
});

test("Real Git discards a regression repair and restores original application files", async () => {
  await withModulePipeline(async f => {
    f.deps.git = await GitCliOps.open(f.options.outputDir);
    const original = f.builder.run.bind(f.builder);
    f.deps.builder.run = async (request, options) => {
      const result = await original(request, options);
      await writeFile(join(request.outputDir, "revision.txt"), request.mode);
      return result;
    };
    f.deps.runner.run = async plan => plan.packetId === "packet-a" ? fail(plan) : pass(plan);
    await f.run();
    assert.equal(await readFile(join(f.options.outputDir, "revision.txt"), "utf8"), "implement");
  });
});

test("Real Git keeps a blocked module's rejected attempt reachable in history", async () => {
  await withModulePipeline(async f => {
    f.deps.git = await GitCliOps.open(f.options.outputDir);
    let starts = 0;
    f.deps.appLifecycle.start = async () => {
      if (++starts <= 2) throw new Error("broken build");
      return { baseUrl: f.options.platformContract.baseUrl, stop: async () => {} };
    };
    const summary = await f.run();
    assert.deepEqual(summary.blockedRequirementIds, ["A", "B", "C"]);
    assert.deepEqual(summary.implementedRequirementIds, []);
    const log = (await import("node:child_process")).execFileSync;
    const subjects = log("git", ["log", "--format=%s"], { cwd: f.options.outputDir }).toString();
    assert.match(subjects, /attempt/);
    const attemptSha = log("git", ["log", "--format=%H", "--grep=shallow: attempt", "-1"], { cwd: f.options.outputDir }).toString().trim();
    assert.match(log("git", ["show", `${attemptSha}:server.mjs`], { cwd: f.options.outputDir }).toString(), /createServer/);
    await assert.rejects(readFile(join(f.options.outputDir, "server.mjs"), "utf8"), /ENOENT/);
  });
});

test("ARC/log failures do not change checkpoints and private Judge data stays outside Builder input", async () => {
  await withModulePipeline(async f => {
    f.deps.logSink = { write() { throw new Error("sink failed"); } };
    f.deps.arcEvents = { runnerState: async () => { throw new Error("ARC unavailable"); },
      requirementState: async () => {}, commitHistorySignal: async () => {}, storeRequirementTree: async () => {} };
    const summary = await f.run();
    assert.equal(summary.status, "delivered");
    assert.doesNotMatch(JSON.stringify(f.builder.requests), /probePlan|locatorSnapshot|acceptedSha|phase budget/);
    assert.ok((await f.events()).some(item => item.type === "arc_projection_failed"));
  });
});

test("Folder nodes receive derived design/implement/test states for the platform requirement denominator", async () => {
  await withModulePipeline(async f => {
    const states: Array<{ id: string; phase: string; status: string }> = [];
    f.deps.arcEvents = {
      runnerState: async () => {},
      requirementState: async (id, phase, status) => { states.push({ id, phase, status }); },
      commitHistorySignal: async () => {},
      storeRequirementTree: async () => {},
    };
    const summary = await f.run();
    assert.equal(summary.status, "delivered");
    const sequence = (id: string) => states.filter(item => item.id === id).map(item => `${item.phase}:${item.status}`);
    assert.deepEqual(sequence("A"),
      ["design:running", "design:completed", "implement:running", "implement:completed", "test:passed"]);
    for (const folder of ["FIRST", "SECOND", "ROOT"]) {
      assert.deepEqual(sequence(folder),
        ["design:running", "design:completed", "implement:running", "implement:completed", "test:passed"], folder);
    }
  });
});

test("Folder rollup reflects blocked and failed descendants", async () => {
  await withModulePipeline(async f => {
    const states: Array<{ id: string; phase: string; status: string }> = [];
    f.deps.arcEvents = {
      runnerState: async () => {},
      requirementState: async (id, phase, status) => { states.push({ id, phase, status }); },
      commitHistorySignal: async () => {},
      storeRequirementTree: async () => {},
    };
    f.deps.builder = new FakeBuilder(["completed", "failed"]);
    f.deps.runner.run = async plan => plan.packetId === "packet-b" ? fail(plan) : pass(plan);
    const summary = await f.run();
    assert.equal(summary.status, "partial");
    const sequence = (id: string) => states.filter(item => item.id === id).map(item => `${item.phase}:${item.status}`);
    // FIRST: A implemented+verified, B implemented but failed audit -> implement completed, test failed.
    assert.deepEqual(sequence("FIRST"),
      ["design:running", "design:completed", "implement:running", "implement:completed", "test:failed"]);
    // SECOND: C depends transitively on failed B, so no Builder call is spent.
    assert.deepEqual(sequence("SECOND"),
      ["design:running", "design:completed", "implement:running", "implement:failed", "test:failed"]);
    // ROOT aggregates the whole tree: the blocked descendant prevents completion.
    assert.deepEqual(sequence("ROOT"),
      ["design:running", "design:completed", "implement:running", "implement:failed", "test:failed"]);
  });
});

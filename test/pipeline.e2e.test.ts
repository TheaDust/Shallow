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
import { withModulePipeline, fail, pass } from "./helpers/module-pipeline.js";

test("Pipeline checks module paths before the full atomic audit and keeps verification separate", async () => {
  await withModulePipeline(async f => {
    const calls: string[] = [];
    f.deps.planner.plan = async (packet, _feedback, options) => {
      calls.push(packet.id);
      if (options?.purpose !== "module_feedback") assert.equal(f.builder.requests.length, 2);
      const { testPlan } = await import("./helpers/module-pipeline.js");
      return testPlan(packet);
    };
    const summary = await f.run();
    assert.equal(summary.status, "delivered");
    assert.deepEqual(f.builder.requests.map(item => "packet" in item ? item.packet.requirementIds : []), [["A", "B"], ["C"]]);
    assert.deepEqual(calls, ["feedback-packet-a", "feedback-packet-c", "packet-a", "packet-b", "packet-c"]);
    assert.deepEqual(summary.implementedRequirementIds, ["A", "B", "C"]);
    assert.deepEqual(summary.verifiedRequirementIds, ["A", "B", "C"]);
    assert.deepEqual(f.git.restoredShas, []);
    assert.equal(f.builder.runOptions[0]?.sessionKey, f.builder.runOptions[1]?.sessionKey);
    assert.equal(f.builder.closeCount, 1);
    const events = await f.events();
    assert.equal(events.filter(item => item.type === "checkpoint_saved").length, 2);
    assert.equal(events.filter(item => item.type === "audit_result").length, 3);
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
      assert.deepEqual(summary.inconclusiveRequirementIds, ["A", "B", "C"]);
      assert.deepEqual(summary.blockedRequirementIds, []);
      assert.deepEqual(f.git.restoredShas, []);
      assert.equal(summary.acceptedSha, "second");
      assert.equal(f.builder.requests.length, 2);
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
    assert.equal(f.builder.runOptions[2]?.sessionKey, undefined);
    assert.equal(calls.get("packet-a"), 3);
    assert.equal(calls.get("packet-b"), 3);
    assert.equal(calls.get("packet-c"), 2);
    assert.equal(summary.status, "delivered");
  });
});

test("A non-reproducible failure stays inconclusive and does not edit the app", async () => {
  await withModulePipeline(async f => {
    const seen = new Set<string>();
    f.deps.runner.run = async plan => { if (seen.has(plan.packetId)) return pass(plan); seen.add(plan.packetId); return fail(plan); };
    const summary = await f.run();
    assert.deepEqual(summary.inconclusiveRequirementIds, ["A", "B", "C"]);
    assert.equal(f.builder.requests.length, 2);
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
      assert.deepEqual(summary.verifiedRequirementIds, ["B", "C"]);
      assert.deepEqual(summary.failedRequirementIds, ["A"]);
      assert.equal(summary.acceptedSha, "second");
      assert.deepEqual(f.git.restoredShas, ["second"]);
      assert.equal(f.builder.requests.length, 3);
    });
  });
}

test("Progressive improvements have at most two consolidated repair rounds even with unlimited time", async () => {
  await withModulePipeline(async f => {
    f.options.totalBudgetMs = 0;
    f.deps.runner.run = async plan => {
      const rounds = f.builder.requests.filter(item => item.mode === "repair").length;
      const ordinal = ["packet-a", "packet-b", "packet-c"].indexOf(plan.packetId);
      return ordinal < rounds ? pass(plan) : fail(plan);
    };
    const summary = await f.run();
    assert.equal(f.builder.requests.length, 4);
    assert.deepEqual(summary.verifiedRequirementIds, ["A", "B"]);
    assert.deepEqual(summary.failedRequirementIds, ["C"]);
  });
});

test("Broken module startup restores its checkpoint, resets conversation, and continues the next module", async () => {
  await withModulePipeline(async f => {
    let starts = 0;
    f.deps.appLifecycle.start = async () => {
      if (++starts === 1) throw new Error("broken build");
      return { baseUrl: f.options.platformContract.baseUrl, stop: async () => {} };
    };
    const summary = await f.run();
    assert.deepEqual(summary.blockedRequirementIds, ["A", "B"]);
    assert.deepEqual(summary.verifiedRequirementIds, ["C"]);
    assert.deepEqual(f.git.restoredShas, ["initial"]);
    assert.notEqual(f.builder.runOptions[0]?.sessionKey, f.builder.runOptions[1]?.sessionKey);
  });
});

test("A failed Builder receipt cannot create an implementation checkpoint", async () => {
  await withModulePipeline(async f => {
    f.deps.builder = new FakeBuilder(["failed", "completed"]);
    const summary = await f.run();
    assert.deepEqual(summary.blockedRequirementIds, ["A", "B"]);
    assert.deepEqual(summary.implementedRequirementIds, ["C"]);
    assert.equal(f.git.captureMessages.length, 2);
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

test("Unlimited delivery still stops after one failed repair and one browser infrastructure retry", async () => {
  await withModulePipeline(async f => {
    f.options.totalBudgetMs = 0;
    let checks = 0;
    f.deps.finalVerifier.verify = async () => { checks++; return { ok: false, stage: "build", message: "broken" }; };
    assert.equal((await f.run()).status, "failed");
    assert.equal(checks, 3);
    assert.equal(f.builder.requests.filter(item => item.mode === "delivery_repair").length, 1);
    assert.deepEqual(f.git.restoredShas, ["second"]);
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

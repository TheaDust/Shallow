import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { httpGatewayFailure } from "../src/gateway-failure.js";
import { GatewayRecovery } from "../src/gateway-recovery.js";
import { GitCliOps } from "../src/git-ops.js";
import { ProbePlannerError } from "../src/judge/llm-probe-planner.js";
import { withModulePipeline, testPlan } from "./helpers/module-pipeline.js";

test("Zero-tool 429 retries the same feature group before advancing implementation", async () => {
  await withModulePipeline(async f => {
    f.options.totalBudgetMs = 0;
    const original = f.builder.run.bind(f.builder);
    const calls: string[] = [];
    f.deps.builder.run = async (request, options) => {
      assert.ok("packet" in request);
      calls.push(request.packet.id);
      if (calls.length <= 4) {
        f.git.applicationChanged = false;
        return { sessionId: "down", outcome: "failed", summary: "429 Free allocated quota exceeded.", gatewayFailure: httpGatewayFailure(429) };
      }
      return original(request, options);
    };
    const summary = await f.run();
    assert.equal(summary.status, "delivered");
    assert.equal(new Set(calls.slice(0, 5)).size, 1);
    assert.notEqual(calls[5], calls[0]);
    assert.deepEqual(summary.pendingRequirementIds, []);
    assert.equal((await f.events()).filter(event => event.type === "module_rescued").length, 0);
  });
});

test("Persistent zero-write outage leaves current and later requirements pending and still verifies the saved app", async () => {
  await withModulePipeline(async f => {
    f.options.totalBudgetMs = 0;
    const original = f.builder.run.bind(f.builder);
    const states: Array<{ id: string; phase: string; status: string }> = [];
    f.deps.arcEvents = { runnerState: async () => {}, storeRequirementTree: async () => {}, commitHistorySignal: async () => {},
      requirementState: async (id, phase, status) => { states.push({ id, phase, status }); } };
    let failures = 0;
    f.deps.builder.run = async (request, options) => {
      assert.ok("packet" in request);
      if (request.packet.requirementIds.includes("C")) {
        failures++;
        f.git.applicationChanged = false;
        return { sessionId: "down", outcome: "failed", summary: "quota exhausted", gatewayFailure: httpGatewayFailure(429) };
      }
      return original(request, options);
    };
    const summary = await f.run();
    assert.equal(summary.status, "partial");
    assert.deepEqual(summary.implementedRequirementIds, ["A", "B"]);
    assert.deepEqual(summary.pendingRequirementIds, ["C"]);
    assert.equal(failures, 6);
    const events = await f.events();
    assert.ok(events.some(event => event.type === "verification_finished" && event.detail?.ok));
    assert.ok(events.some(event => event.type === "implementation_paused"));
    assert.ok(!events.some(event => event.type === "module_rescued"));
    assert.ok(!states.some(event => ["C", "SECOND", "ROOT"].includes(event.id) && event.phase === "implement" && event.status === "completed"));
  });
});

test("Unrunnable partial gateway work is rolled back before retrying the same packet", async () => {
  await withModulePipeline(async f => {
    f.options.totalBudgetMs = 0;
    f.deps.git = await GitCliOps.open(f.options.outputDir);
    const original = f.builder.run.bind(f.builder);
    const marker = join(f.options.outputDir, "broken.txt");
    let calls = 0;
    f.deps.appLifecycle.start = async () => {
      const broken = await readFile(marker, "utf8").catch(() => "");
      if (broken) throw new Error("build is broken");
      return { baseUrl: f.options.platformContract.baseUrl, stop: async () => {} };
    };
    f.deps.builder.run = async (request, options) => {
      if (++calls === 1) {
        await original(request, options);
        await writeFile(marker, "broken");
        return { sessionId: "down", outcome: "failed", summary: "429", gatewayFailure: httpGatewayFailure(429) };
      }
      await assert.rejects(readFile(marker, "utf8"), { code: "ENOENT" });
      return original(request, options);
    };
    assert.equal((await f.run()).status, "delivered");
    const events = await f.events();
    assert.ok(events.some(event => event.type === "builder_work_preserved" && event.detail?.preserved === false));
    assert.ok(!events.some(event => event.type === "module_rescued"));
  });
});

test("Interrupted source changes survive recovery and are not marked implemented when the gateway stays unavailable", async () => {
  await withModulePipeline(async f => {
    f.options.totalBudgetMs = 0;
    f.deps.git = await GitCliOps.open(f.options.outputDir);
    const original = f.builder.run.bind(f.builder);
    let calls = 0;
    f.deps.builder.run = async (request, options) => {
      calls++;
      if (calls === 1) {
        await original(request, options);
        await writeFile(join(request.outputDir, "partial.txt"), "keep this work");
      } else assert.equal(await readFile(join(request.outputDir, "partial.txt"), "utf8"), "keep this work");
      return { sessionId: "interrupted", outcome: "failed", summary: "429", gatewayFailure: httpGatewayFailure(429) };
    };
    const summary = await f.run();
    assert.equal(summary.status, "partial");
    assert.deepEqual(summary.implementedRequirementIds, []);
    assert.deepEqual(summary.pendingRequirementIds, ["A", "B", "C"]);
    assert.equal(await readFile(join(f.options.outputDir, "partial.txt"), "utf8"), "keep this work");
    const checkpoints = (await f.events()).filter(event => event.type === "checkpoint_saved");
    assert.equal(checkpoints.length, 1);
    assert.deepEqual(checkpoints[0].detail?.requirementIds, []);
  });
});

test("Ordinary failed calls cannot rescue an unchanged old application", async () => {
  await withModulePipeline(async f => {
    f.deps.git = await GitCliOps.open(f.options.outputDir);
    const original = f.builder.run.bind(f.builder);
    f.deps.builder.run = async (request, options) => {
      if ("packet" in request && request.packet.requirementIds.includes("C")) {
        return { sessionId: "empty", outcome: "failed", summary: "No model response" };
      }
      return original(request, options);
    };
    const summary = await f.run();
    assert.deepEqual(summary.implementedRequirementIds, ["A", "B"]);
    assert.deepEqual(summary.blockedRequirementIds, ["C"]);
    assert.ok(!(await f.events()).some(event => event.type === "module_rescued"));
  });
});

test("Planner 429 recovers within the module rather than deferring all feedback to the final audit", async () => {
  await withModulePipeline(async f => {
    f.options.totalBudgetMs = 0;
    let attempts = 0;
    f.deps.planner.plan = async packet => {
      if (++attempts === 1) throw new ProbePlannerError("transport", "HTTP 429", { httpStatus: 429 });
      return testPlan(packet);
    };
    assert.equal((await f.run()).status, "delivered");
    const events = await f.events();
    assert.ok(events.some(event => event.type === "gateway_wait" && event.detail?.source === "planner"));
    assert.ok(!events.some(event => event.type === "probe_planner_failed"));
  });
});

test("A short implementation budget stops recovery with requirements pending and preserves delivery time", async () => {
  await withModulePipeline(async f => {
    let elapsed = 0;
    f.options.totalBudgetMs = 10_000;
    f.deps.clock = { nowMs: () => elapsed };
    f.deps.gatewayRecovery = new GatewayRecovery({ now: () => elapsed, sleep: async ms => { elapsed += ms; } });
    f.git.applicationChanged = false;
    let calls = 0;
    f.deps.builder.run = async () => {
      calls++;
      return { sessionId: "down", outcome: "failed", summary: "429", gatewayFailure: httpGatewayFailure(429) };
    };
    const summary = await f.run();
    assert.equal(calls, 1);
    assert.equal(elapsed, 0);
    assert.deepEqual(summary.implementedRequirementIds, []);
    assert.deepEqual(summary.pendingRequirementIds, ["A", "B", "C"]);
    assert.ok((await f.events()).some(event => event.type === "delivery_finished"));
  });
});

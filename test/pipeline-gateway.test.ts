import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { httpGatewayFailure } from "../src/gateway-failure.js";
import { GatewayRecovery } from "../src/gateway-recovery.js";
import { GitCliOps } from "../src/git-ops.js";
import { ProbePlannerError } from "../src/judge/llm-probe-planner.js";
import { withModulePipeline, testPlan, fail, pass } from "./helpers/module-pipeline.js";

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

test("A bounded implementation budget leaves gateway-blocked requirements blocked and still delivers", async () => {
  await withModulePipeline(async f => {
    let elapsed = 0;
    f.options.totalBudgetMs = 10_000;
    f.deps.clock = { nowMs: () => elapsed };
    f.deps.gatewayRecovery = new GatewayRecovery({ now: () => elapsed, sleep: async ms => { elapsed += ms; } });
    const original = f.builder.run.bind(f.builder);
    f.deps.builder.run = async (request, options) => {
      assert.ok("packet" in request);
      if (request.packet.requirementIds.includes("C")) {
        f.git.applicationChanged = false;
        return { sessionId: "down", outcome: "failed", summary: "quota exhausted", gatewayFailure: httpGatewayFailure(429) };
      }
      return original(request, options);
    };
    const summary = await f.run();
    assert.equal(summary.status, "partial");
    assert.deepEqual(summary.implementedRequirementIds, ["A", "B"]);
    assert.deepEqual(summary.blockedRequirementIds, ["C"]);
    assert.deepEqual(summary.pendingRequirementIds, []);
    const events = await f.events();
    assert.ok(events.some(event => event.type === "implementation_paused"));
    assert.ok(events.some(event => event.type === "verification_finished" && event.detail?.ok));
    assert.ok(events.some(event => event.type === "delivery_finished"));
  });
});

test("A gateway outage longer than one call window pauses and resumes the same packet", async () => {
  await withModulePipeline(async f => {
    let elapsed = 0;
    f.options.totalBudgetMs = 0;
    f.deps.clock = { nowMs: () => elapsed };
    f.deps.gatewayRecovery = new GatewayRecovery({ now: () => elapsed, sleep: async ms => { elapsed += ms; } });
    const original = f.builder.run.bind(f.builder);
    const calls: string[] = [];
    f.deps.builder.run = async (request, options) => {
      assert.ok("packet" in request);
      calls.push(request.packet.id);
      if (calls.length <= 25) {
        f.git.applicationChanged = false;
        return { sessionId: "down", outcome: "failed", summary: "quota exhausted", gatewayFailure: httpGatewayFailure(429) };
      }
      return original(request, options);
    };
    const summary = await f.run();
    assert.equal(summary.status, "delivered");
    assert.deepEqual(summary.pendingRequirementIds, []);
    assert.equal(new Set(calls.slice(0, 26)).size, 1);
    assert.ok(elapsed > 90 * 60_000, `expected the outage to outlast one call window, saw ${elapsed}ms`);
    const events = await f.events();
    assert.ok(events.some(event => event.type === "implementation_paused"));
    assert.equal(events.filter(event => event.type === "module_rescued").length, 0);
  });
});

test("A non-retryable gateway rejection stops dispatch instead of retrying without backoff", async () => {
  await withModulePipeline(async f => {
    f.options.totalBudgetMs = 0;
    let calls = 0;
    f.deps.builder.run = async () => {
      calls++;
      if (calls > 1) throw new Error("non-retryable rejection was retried");
      return { sessionId: "bad", outcome: "failed", summary: "HTTP 400 bad request", gatewayFailure: httpGatewayFailure(400) };
    };
    const summary = await f.run();
    assert.equal(calls, 1);
    assert.equal(summary.status, "partial");
    assert.deepEqual(summary.pendingRequirementIds, ["A", "B", "C"]);
    const events = await f.events();
    assert.ok(events.some(event => event.type === "implementation_stopped"));
    assert.equal(events.filter(event => event.type === "implementation_paused").length, 0);
  });
});

test("An upstream reset wrapped in HTTP 400 retries the same feature group", async () => {
  await withModulePipeline(async f => {
    f.options.totalBudgetMs = 0;
    let elapsed = 0;
    f.deps.clock = { nowMs: () => elapsed };
    f.deps.gatewayRecovery = new GatewayRecovery({ now: () => elapsed, sleep: async ms => { elapsed += ms; } });
    const original = f.builder.run.bind(f.builder);
    const calls: string[] = [];
    f.deps.builder.run = async (request, options) => {
      if (request.mode === "implement") {
        calls.push(request.packet.id);
        if (calls.length === 1) return { sessionId: "upstream-reset", outcome: "failed", summary: "connection reset by peer",
          gatewayFailure: { kind: "unavailable", retryable: true, status: 400 } };
      }
      return original(request, options);
    };
    const summary = await f.run();
    assert.equal(summary.status, "delivered");
    assert.equal(calls[0], calls[1]);
    assert.equal(elapsed, 5_000);
    assert.ok(!(await f.events()).some(event => event.type === "implementation_stopped"));
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
    let elapsed = 0;
    f.options.totalBudgetMs = 100_000;
    f.deps.clock = { nowMs: () => elapsed };
    f.deps.gatewayRecovery = new GatewayRecovery({ now: () => elapsed, sleep: async ms => { elapsed += ms; } });
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
    assert.deepEqual(summary.blockedRequirementIds, ["A", "B"]);
    assert.deepEqual(summary.pendingRequirementIds, ["C"]);
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

test("Planner calls use the phase budget instead of a 180-second attempt timer", async () => {
  await withModulePipeline(async f => {
    f.options.totalBudgetMs = 1_000_000;
    f.deps.clock = { nowMs: () => 0 };
    const timeouts: number[] = [];
    f.deps.planner.plan = async (packet, _feedback, options) => {
      timeouts.push(options?.timeoutMs ?? 0);
      return testPlan(packet);
    };
    assert.equal((await f.run()).status, "delivered");
    assert.ok(timeouts.length > 0);
    assert.ok(timeouts.every(timeout => timeout >= 600_000), JSON.stringify(timeouts));
  });
});

test("Planner calls have no local deadline when the run budget is unlimited", async () => {
  await withModulePipeline(async f => {
    f.options.totalBudgetMs = 0;
    const timeouts: number[] = [];
    f.deps.planner.plan = async (packet, _feedback, options) => {
      timeouts.push(options?.timeoutMs ?? 0);
      return testPlan(packet);
    };
    assert.equal((await f.run()).status, "delivered");
    assert.ok(timeouts.length > 0);
    assert.ok(timeouts.every(timeout => timeout === Infinity), JSON.stringify(timeouts));
  });
});

test("A gateway outage during boundary repair postpones the round instead of abandoning the module", async () => {
  await withModulePipeline(async f => {
    let runs = 0;
    f.deps.runner.run = async plan => { runs++; return runs <= 2 ? fail(plan) : pass(plan); };
    const original = f.builder.run.bind(f.builder);
    let repairCalls = 0;
    f.deps.builder.run = async (request, options) => {
      if (request.mode === "repair" && ++repairCalls <= 6) {
        return { sessionId: "down", outcome: "failed", summary: "429", gatewayFailure: httpGatewayFailure(429) };
      }
      return original(request, options);
    };
    const summary = await f.run();
    assert.equal(summary.status, "delivered");
    const finished = (await f.events()).filter(event => event.type === "repair_batch_finished");
    assert.equal(finished.length, 1);
    assert.equal(finished[0].detail?.retained, true);
    assert.equal(repairCalls, 7);
  });
});

test("A short implementation budget bounds gateway recovery and preserves delivery time", async () => {
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
    assert.equal(elapsed, 6_000);
    assert.deepEqual(summary.implementedRequirementIds, []);
    assert.deepEqual(summary.blockedRequirementIds, ["A", "B"]);
    assert.deepEqual(summary.pendingRequirementIds, ["C"]);
    assert.ok((await f.events()).some(event => event.type === "delivery_finished"));
  });
});

test("A gateway outage during the timeout retry pauses and resumes the same packet", async () => {
  await withModulePipeline(async f => {
    let elapsed = 0;
    f.options.totalBudgetMs = 0;
    f.deps.clock = { nowMs: () => elapsed };
    f.deps.gatewayRecovery = new GatewayRecovery({ now: () => elapsed, sleep: async ms => { elapsed += ms; } });
    const original = f.builder.run.bind(f.builder);
    const calls: string[] = [];
    f.deps.builder.run = async (request, options) => {
      assert.ok("packet" in request);
      calls.push(request.packet.id);
      if (calls.length === 1) return { sessionId: "slow", outcome: "timed_out", summary: "deadline" };
      if (elapsed < 90 * 60_000) {
        return { sessionId: "down", outcome: "failed", summary: "429", gatewayFailure: httpGatewayFailure(429) };
      }
      return original(request, options);
    };
    const summary = await f.run();
    assert.equal(summary.status, "delivered");
    assert.ok(elapsed > 45 * 60_000, `expected the outage to outlast the timeout-retry window, saw ${elapsed}ms`);
    const events = await f.events();
    assert.ok(events.some(event => event.type === "implementation_retry"));
    assert.ok(events.some(event => event.type === "implementation_paused"));
    assert.equal(events.filter(event => event.type === "module_rescued").length, 0);
  });
});

test("A gateway outage spanning multiple call windows pauses repeatedly and still completes the same packet", async () => {
  await withModulePipeline(async f => {
    let elapsed = 0;
    f.options.totalBudgetMs = 0;
    f.deps.clock = { nowMs: () => elapsed };
    f.deps.gatewayRecovery = new GatewayRecovery({ now: () => elapsed, sleep: async ms => { elapsed += ms; } });
    const original = f.builder.run.bind(f.builder);
    const calls: string[] = [];
    f.deps.builder.run = async (request, options) => {
      assert.ok("packet" in request);
      calls.push(request.packet.id);
      // One implementation call window is 90 minutes; fail past two windows.
      if (elapsed < 190 * 60_000) {
        f.git.applicationChanged = false;
        return { sessionId: "down", outcome: "failed", summary: "quota exhausted", gatewayFailure: httpGatewayFailure(429) };
      }
      return original(request, options);
    };
    const summary = await f.run();
    assert.equal(summary.status, "delivered");
    assert.deepEqual(summary.pendingRequirementIds, []);
    const firstPacketId = calls[0];
    let samePacketCalls = 0;
    while (samePacketCalls < calls.length && calls[samePacketCalls] === firstPacketId) samePacketCalls++;
    assert.ok(samePacketCalls > 20, `expected the same packet to be retried across call windows, saw ${samePacketCalls} calls`);
    const events = await f.events();
    const pauses = events.filter(event => event.type === "implementation_paused" && event.packetId === firstPacketId);
    assert.ok(pauses.length >= 2, `expected repeated implementation_paused events, saw ${pauses.length}`);
    assert.ok(elapsed >= 190 * 60_000, `expected the outage to span multiple call windows, saw ${elapsed}ms`);
    assert.equal(events.filter(event => event.type === "module_rescued").length, 0);
  });
});

test("Semantic review is routed through planner gateway recovery", async () => {
  await withModulePipeline(async f => {
    f.options.totalBudgetMs = 0;
    f.deps.runner.run = async plan => fail(plan);
    let reviews = 0;
    f.deps.planner.reviewPlan = async () => {
      reviews += 1;
      if (reviews === 1) throw new ProbePlannerError("transport", "HTTP 429", { httpStatus: 429 });
      return { status: "sound", rationale: "429 recovered" };
    };
    await f.run();
    assert.ok(reviews >= 2);
    assert.ok((await f.events()).some(event => event.type === "gateway_wait" && event.detail?.source === "planner"));
  });
});

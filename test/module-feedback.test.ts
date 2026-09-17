import test from "node:test";
import assert from "node:assert/strict";
import { withModulePipeline, pass, fail } from "./helpers/module-pipeline.js";

test("Sampled module passes do not replace full audit plans or publish full requirement passes", async () => {
  await withModulePipeline(async f => {
    f.deps.runner.run = async plan => plan.packetId.startsWith("feedback-") ? pass(plan) : fail(plan, "locator");
    const summary = await f.run();
    assert.deepEqual(summary.verifiedRequirementIds, []);
    assert.equal(f.builder.requests.length, 2);
    const feedback = (await f.events()).filter(e => e.type === "module_feedback");
    assert.equal(feedback.length, 3);
    assert.ok(feedback.every(e => e.detail?.status === "passed"));
  });
});

test("A reproducible old-path regression keeps the new module when its one boundary repair fails", async () => {
  await withModulePipeline(async f => {
    f.deps.runner.run = async plan => {
      const moduleCStarted = f.builder.requests.some(item => "packet" in item && item.packet.requirementIds.includes("C"));
      if (plan.packetId === "feedback-packet-a") return moduleCStarted ? fail(plan) : pass(plan);
      if (plan.packetId === "packet-a") {
        // The consolidated repair (whether from boundary or consolidated phase) fixes A.
        const anyRepair = f.builder.requests.some(item => item.mode === "repair");
        return anyRepair ? pass(plan) : fail(plan);
      }
      return pass(plan);
    };
    const summary = await f.run();
    assert.deepEqual(summary.implementedRequirementIds, ["A", "B", "C"]);
    assert.deepEqual(summary.blockedRequirementIds, []);
    assert.deepEqual(summary.verifiedRequirementIds, ["A", "B", "C"]);
    // Boundary and/or consolidated repairs may exist; at least one repair happened.
    assert.ok(f.builder.requests.filter(r => r.mode === "repair").length >= 1);
    const events = await f.events();
    const kept = events.filter(item => item.type === "module_regression_kept");
    assert.equal(kept.length, 1);
    assert.deepEqual(kept[0].detail?.requirementIds, ["C"]);
    assert.deepEqual(kept[0].detail?.regressedRequirementIds, ["A"]);
  });
});

test("Boundary and consolidated repairs have independent quotas", async () => {
  await withModulePipeline(async f => {
    f.deps.runner.run = async plan => fail(plan);
    const summary = await f.run();
    assert.deepEqual(summary.implementedRequirementIds, ["A", "B", "C"]);
    // Boundary repairs (per-module quota) and consolidated repairs (global quota) are independent.
    // FIRST module: 1 boundary repair (stops early because no improvement)
    // SECOND module: 1 boundary repair (quota resets, stops early)
    // Consolidated: 2 repairs (global quota, stops early)
    // Total: 4 repairs
    assert.equal(f.builder.requests.filter(r => r.mode === "repair").length, 4);
    assert.equal(summary.verifiedRequirementIds.length, 0);
  });
});

test("An independent feedback repair that fixes the failed path is retained; implementation packets use fresh sessions", async () => {
  await withModulePipeline(async f => {
    f.deps.runner.run = async plan => plan.packetId === "feedback-packet-a" && f.builder.requests.length === 1 ? fail(plan) : pass(plan);
    const summary = await f.run();
    assert.equal(summary.status, "delivered");
    assert.equal(f.builder.requests[1].mode, "repair");
    assert.equal(f.builder.runOptions[0]?.sessionKey, undefined);
    assert.equal(f.builder.runOptions[1]?.sessionKey, undefined);
    assert.equal(f.builder.runOptions[2]?.sessionKey, undefined);
    assert.equal(f.git.restoredShas.length, 0);
  });
});

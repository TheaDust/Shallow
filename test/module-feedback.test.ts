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
        const consolidatedRepair = f.builder.requests.some(item => item.mode === "repair" && "packet" in item && item.packet.id.startsWith("repair-round"));
        return consolidatedRepair ? pass(plan) : fail(plan);
      }
      return pass(plan);
    };
    const summary = await f.run();
    // The new module C is kept instead of reverted to A: it is implemented, and
    // the consolidated repair later fixes the regressed path A.
    assert.deepEqual(summary.implementedRequirementIds, ["A", "B", "C"]);
    assert.deepEqual(summary.blockedRequirementIds, []);
    assert.deepEqual(summary.verifiedRequirementIds, ["A", "B", "C"]);
    // One boundary repair attempt (feedback-repair), then one consolidated repair.
    assert.equal(f.builder.requests.filter(r => r.mode === "repair").length, 2);
    // Only the failed boundary repair is rewound to the pre-repair state; the
    // previous module checkpoint is never restored.
    assert.deepEqual(f.git.restoredShas, ["second"]);
    const events = await f.events();
    const kept = events.filter(item => item.type === "module_regression_kept");
    assert.equal(kept.length, 1);
    assert.deepEqual(kept[0].detail?.requirementIds, ["C"]);
    assert.deepEqual(kept[0].detail?.regressedRequirementIds, ["A"]);
  });
});

test("Unhelpful new-path repair retains runnable B and early repairs share the global two-call quota", async () => {
  await withModulePipeline(async f => {
    f.deps.runner.run = async plan => fail(plan);
    const summary = await f.run();
    assert.deepEqual(summary.implementedRequirementIds, ["A", "B", "C"]);
    assert.equal(f.builder.requests.filter(r => r.mode === "repair").length, 2);
    assert.ok(f.builder.requests.filter(r => r.mode === "repair").every(r => "packet" in r && r.packet.id.startsWith("feedback-repair")));
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

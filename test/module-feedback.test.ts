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

test("A reproducible old-path regression restores A when its one boundary repair fails", async () => {
  await withModulePipeline(async f => {
    f.deps.runner.run = async plan => plan.packetId === "feedback-packet-a" && f.builder.requests.length >= 2 ? fail(plan) : pass(plan);
    const summary = await f.run();
    assert.deepEqual(summary.implementedRequirementIds, ["A", "B"]);
    assert.deepEqual(summary.blockedRequirementIds, ["C"]);
    assert.equal(f.builder.requests.filter(r => r.mode === "repair").length, 1);
    assert.equal(f.git.restoredShas.at(-1), "first");
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

test("An independent feedback repair that fixes the failed path is retained and resets implementation conversation", async () => {
  await withModulePipeline(async f => {
    f.deps.runner.run = async plan => plan.packetId === "feedback-packet-a" && f.builder.requests.length === 1 ? fail(plan) : pass(plan);
    const summary = await f.run();
    assert.equal(summary.status, "delivered");
    assert.equal(f.builder.requests[1].mode, "repair");
    assert.equal(f.builder.runOptions[1]?.sessionKey, undefined);
    assert.notEqual(f.builder.runOptions[0]?.sessionKey, f.builder.runOptions[2]?.sessionKey);
    assert.equal(f.git.restoredShas.length, 0);
  });
});

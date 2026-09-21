import assert from "node:assert/strict";
import { test } from "node:test";
import { withModulePipeline } from "./helpers/module-pipeline.js";

test("Build failure continues only the same packet/session within its remaining budget", async () => {
  await withModulePipeline(async f => {
    let clock = 0;
    f.deps.clock = { nowMs: () => clock };
    const original = f.builder.run.bind(f.builder);
    f.deps.builder.run = async (request, options) => {
      const result = await original(request, options);
      clock += 1000;
      return result;
    };
    let starts = 0;
    f.deps.appLifecycle.start = async () => {
      if (++starts === 1) throw new Error("build exited 1: missing export");
      return { baseUrl: f.options.platformContract.baseUrl, stop: async () => {} };
    };
    const summary = await f.run();
    assert.equal(summary.status, "delivered");
    assert.equal(f.builder.requests.length, 3);
    const [first, continued, next] = f.builder.runOptions;
    assert.ok(first?.sessionKey);
    assert.equal(continued?.sessionKey, first.sessionKey);
    assert.notEqual(next?.sessionKey, first.sessionKey);
    assert.equal(continued?.timeoutMs, first.timeoutMs! - 1000);
    assert.match(continued?.continuationFeedback ?? "", /missing export/);
    assert.deepEqual(f.git.restoredShas, []);
    assert.equal((await f.events()).filter(e => e.type === "implementation_continued").length, 1);
  });
});

test("Persistent build failure gets one continuation then rolls back before the next packet", async () => {
  await withModulePipeline(async f => {
    f.deps.appLifecycle.start = async () => { throw new Error("build failed"); };
    const summary = await f.run();
    assert.equal(f.builder.requests.length, 4);
    assert.equal(summary.status, "partial");
    assert.deepEqual(summary.implementedRequirementIds, []);
    assert.equal(f.git.restoredShas.length, 2);
    assert.notEqual(f.builder.runOptions[2]?.sessionKey, f.builder.runOptions[1]?.sessionKey);
    assert.equal((await f.events()).filter(e => e.type === "implementation_continued").length, 2);
  });
});

test("Exhausted implementation budget prevents continuation and retains delivery time", async () => {
  await withModulePipeline(async f => {
    let clock = 0;
    f.deps.clock = { nowMs: () => clock };
    f.deps.appLifecycle.start = async () => { clock = 36_000; throw new Error("build failed"); };
    const summary = await f.run();
    assert.equal(f.builder.requests.length, 1);
    assert.equal(summary.status, "partial");
    assert.ok(!(await f.events()).some(e => e.type === "implementation_continued"));
  });
});

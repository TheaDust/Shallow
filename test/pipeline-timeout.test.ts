import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { GitCliOps } from "../src/git-ops.js";
import { withModulePipeline } from "./helpers/module-pipeline.js";

for (const runnable of [true, false]) {
  test(`Timed-out implementation retries the same packet after ${runnable ? "preserving" : "rolling back"} partial work`, async () => {
    await withModulePipeline(async f => {
      f.options.totalBudgetMs = 0;
      f.deps.git = await GitCliOps.open(f.options.outputDir);
      const marker = join(f.options.outputDir, "partial.txt");
      const original = f.builder.run.bind(f.builder);
      let calls = 0;
      f.deps.appLifecycle.start = async () => {
        if (!runnable && calls === 1) throw new Error("Application port is already occupied");
        return { baseUrl: f.options.platformContract.baseUrl, stop: async () => {} };
      };
      f.deps.builder.run = async (request, options) => {
        if (++calls === 1) {
          await original(request, options);
          await writeFile(marker, "partial work");
          return { sessionId: "timeout", outcome: "timed_out", summary: "Pi call deadline reached" };
        }
        if (calls === 2) {
          assert.equal(request.mode, "implement");
          assert.ok("packet" in request);
          assert.equal(request.packet.id, (f.builder.requests[0] as typeof request).packet.id);
          assert.equal(request.packet.attempt, 2);
          assert.equal(options?.sessionKey, undefined);
          assert.equal(options?.timeoutMs, 2_700_000);
          if (runnable) assert.equal(await readFile(marker, "utf8"), "partial work");
          else await assert.rejects(readFile(marker), { code: "ENOENT" });
        }
        return original(request, options);
      };
      assert.equal((await f.run()).status, "delivered");
      assert.equal(calls, 3);
      const events = await f.events();
      assert.equal(events.filter(e => e.type === "implementation_retry").length, 1);
      assert.ok(events.some(e => e.type === "builder_work_preserved" && e.detail?.preserved === runnable));
      assert.ok(!events.some(e => e.type === "module_rescued"));
    });
  });
}

test("Repeated timeouts preserve runnable code without falsely completing its requirements", async () => {
  await withModulePipeline(async f => {
    f.options.totalBudgetMs = 0;
    f.deps.git = await GitCliOps.open(f.options.outputDir);
    const original = f.builder.run.bind(f.builder);
    let calls = 0;
    f.deps.builder.run = async (request, options) => {
      await original(request, options);
      await writeFile(join(request.outputDir, "partial.txt"), `work ${++calls}`);
      return { sessionId: "timeout", outcome: "timed_out", summary: "Pi call deadline reached" };
    };
    const summary = await f.run();
    assert.equal(calls, 2); // the failed foundation gets two calls; its dependent gets none
    assert.equal(summary.status, "partial");
    assert.deepEqual(summary.implementedRequirementIds, []);
    assert.deepEqual(summary.blockedRequirementIds, ["A", "B", "C"]);
    assert.equal(await readFile(join(f.options.outputDir, "partial.txt"), "utf8"), "work 2");
    const checkpoints = (await f.events()).filter(e => e.type === "checkpoint_saved");
    assert.equal(checkpoints.length, 2);
    assert.ok(checkpoints.every(e => e.detail?.requirementIds.length === 0));
  });
});

test("Implementation timeout does not spend the delivery reserve on another attempt", async () => {
  await withModulePipeline(async f => {
    let now = 0;
    let calls = 0;
    let delivered = false;
    f.deps.clock = { nowMs: () => now };
    f.git.applicationChanged = false;
    f.deps.builder.run = async () => {
      calls++;
      now = f.options.totalBudgetMs * 0.6;
      return { sessionId: "timeout", outcome: "timed_out", summary: "Pi call deadline reached" };
    };
    f.deps.finalVerifier.verify = async () => { delivered = true; return { ok: true, stage: "complete", message: "ready" }; };
    const summary = await f.run();
    assert.equal(calls, 1);
    assert.equal(delivered, true);
    assert.deepEqual(summary.implementedRequirementIds, []);
    assert.ok(!(await f.events()).some(e => e.type === "implementation_retry"));
  });
});

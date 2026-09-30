import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { withModulePipeline, pass, fail } from "./helpers/module-pipeline.js";

test("Missing or empty terminal response gets a 45 minute fresh continuation before dependencies run", async () => {
  for (const reason of ["missing_terminal_response", "empty_terminal_response", "model_length_limit"] as const) {
    await withModulePipeline(async f => {
      f.options.totalBudgetMs = 0;
      const original = f.builder.run.bind(f.builder);
      f.builder.run = async (request, options) => {
        const result = await original(request, options);
        if (f.builder.requests.length === 1) return { ...result, outcome: "failed", terminationReason: reason };
        return result;
      };
      const summary = await f.run();
      assert.equal(summary.status, "delivered");
      assert.equal(f.builder.requests.length, 3);
      assert.equal(f.builder.runOptions[1]?.timeoutMs, 2_700_000);
      assert.equal(f.builder.runOptions[1]?.resumeInterrupted, true);
      assert.equal(f.builder.runOptions[1]?.sessionKey, undefined);
      assert.deepEqual(summary.blockedRequirementIds, []);
    });
  }
});

test("An unfinished compound package is completed atom by atom before its downstream package", async () => {
  await withModulePipeline(async f => {
    const original = f.builder.run.bind(f.builder);
    f.builder.run = async (request, options) => {
      const result = await original(request, options);
      if (request.mode === "implement" && request.packet.requirementIds.length > 1) {
        return { ...result, outcome: "timed_out" };
      }
      return result;
    };
    const summary = await f.run();
    assert.equal(summary.status, "delivered");
    assert.deepEqual(f.builder.requests.map(request => "packet" in request ? request.packet.requirementIds : []),
      [["A", "B"], ["A", "B"], ["A"], ["B"], ["C"]]);
    const split = (await f.events()).find(event => event.type === "implementation_split");
    assert.ok(split?.type === "implementation_split");
    assert.deepEqual(split.detail?.packets.map(packet => packet.requirementIds), [["A"], ["B"]]);
    assert.equal((await f.events()).filter(event => event.type === "dependency_gate_blocked").length, 0);
    assert.ok(f.builder.requests.slice(2, 4).every(request => "packet" in request && request.packet.attempt === 3));
  });
});

test("A compound package that times out after context overflow splits before a whole-package continuation", async () => {
  await withModulePipeline(async f => {
    const original = f.builder.run.bind(f.builder);
    f.builder.run = async (request, options) => {
      const result = await original(request, options);
      if (request.mode === "implement" && request.packet.requirementIds.length > 1) {
        return { ...result, outcome: "timed_out", execution: {
          engine: "fake", version: "1", nodeVersion: process.version, workerPid: 1, resumed: false,
          durationMs: 5_400_000, cleanupMs: 0, usage: { status: "unavailable" },
          termination: { compactionPending: false, retryPending: true, compactionReason: "overflow" },
        } };
      }
      return result;
    };
    const summary = await f.run();
    assert.equal(summary.status, "delivered");
    assert.deepEqual(f.builder.requests.map(request => "packet" in request ? request.packet.requirementIds : []),
      [["A", "B"], ["A"], ["B"], ["C"]]);
    assert.equal(f.builder.runOptions.some(options => options?.resumeInterrupted), false);
    const split = (await f.events()).find(event => event.type === "implementation_split" && event.detail?.kind === "recovery");
    assert.ok(split?.type === "implementation_split");
    assert.ok(split.detail);
    assert.match(split.detail.reason, /exhausted the context window/);
  });
});

test("Atomic recovery stays bounded when a foundation cannot complete", async () => {
  await withModulePipeline(async f => {
    const original = f.builder.run.bind(f.builder);
    f.builder.run = async (request, options) => ({ ...await original(request, options), outcome: "timed_out" });
    const summary = await f.run();
    assert.equal(f.builder.requests.length, 3, "initial package, continuation, foundation atomic recovery; dependent atom cannot run");
    assert.deepEqual(summary.blockedRequirementIds, ["A", "B", "C"]);
    assert.deepEqual(summary.implementedRequirementIds, []);
  });
});

test("Interrupted changes that regress an earlier passed path are restored before continuation", async () => {
  await withModulePipeline(async f => {
    let changed = false;
    const original = f.builder.run.bind(f.builder);
    f.builder.run = async (request, options) => {
      const result = await original(request, options);
      if (request.mode === "implement" && request.packet.requirementIds.includes("C") && !options?.resumeInterrupted) {
        changed = true;
        return { ...result, outcome: "failed", terminationReason: "missing_terminal_response" };
      }
      return result;
    };
    const restore = f.git.restoreAccepted.bind(f.git);
    f.git.restoreAccepted = async sha => { changed = false; await restore(sha); };
    f.deps.runner.run = async plan => plan.packetId === "packet-a" && changed ? fail(plan) : pass(plan);
    assert.equal((await f.run()).status, "delivered");
    assert.equal(f.git.restoredShas.length, 1);
    const guard = (await f.events()).find(event => event.type === "builder_work_preserved");
    assert.equal(guard?.detail?.preserved, false);
    assert.match(String(guard?.detail?.reason), /previously passed behavior: A/);
    assert.equal(f.builder.runOptions.at(-1)?.resumeInterrupted, true);
  });
});

test("A mixed dependency group still implements its independent member after a foundation exhausts recovery", async () => {
  await withModulePipeline(async f => {
    const tree = JSON.parse(await readFile(f.options.requirementsFile, "utf8"));
    tree.children[1].children.push({ id: "D", name: "Independent", type: "ATOMIC", dependencies: [], description: "Display an independent workspace." });
    await writeFile(f.options.requirementsFile, JSON.stringify(tree));
    const original = f.builder.run.bind(f.builder);
    f.builder.run = async (request, options) => {
      const result = await original(request, options);
      if (request.mode === "implement" && request.packet.requirementIds.includes("A")) return { ...result, outcome: "timed_out" };
      return result;
    };
    const summary = await f.run();
    assert.deepEqual(summary.implementedRequirementIds, ["D"]);
    assert.deepEqual(summary.blockedRequirementIds, ["A", "B", "C"]);
    assert.ok(f.builder.requests.some(request => "packet" in request && request.packet.requirementIds.join() === "D"));
    assert.equal(f.builder.requests.some(request => "packet" in request && request.packet.requirementIds.includes("C")), false);
    assert.equal((await f.events()).filter(event => event.type === "implementation_split").length, 2);
  });
});

test("A member split out for dependency readiness keeps first-attempt limits and its continuation", async () => {
  await withModulePipeline(async f => {
    f.options.totalBudgetMs = 0;
    const tree = JSON.parse(await readFile(f.options.requirementsFile, "utf8"));
    // SECOND becomes a mixed packet: C waits on the blocked B, D is independent.
    tree.children[1].children.push({ id: "D", name: "Independent", type: "ATOMIC", dependencies: [], description: "Display an independent workspace." });
    await writeFile(f.options.requirementsFile, JSON.stringify(tree));
    let dTimedOut = false;
    const original = f.builder.run.bind(f.builder);
    f.builder.run = async (request, options) => {
      const result = await original(request, options);
      if (request.mode !== "implement") return result;
      if (request.packet.requirementIds.includes("A")) return { ...result, outcome: "timed_out" };
      if (request.packet.requirementIds.join() === "D" && !dTimedOut) { dTimedOut = true; return { ...result, outcome: "timed_out" }; }
      return result;
    };
    const summary = await f.run();
    const split = (await f.events()).find(event => event.type === "implementation_split" && event.detail?.kind === "dependency");
    assert.ok(split?.type === "implementation_split");
    assert.ok(split.detail?.packets.every(packet => packet.packetId.includes("-split-")));
    const dIndex = f.builder.requests.findIndex(request => "packet" in request && request.packet.requirementIds.join() === "D");
    const dRequest = f.builder.requests[dIndex];
    assert.ok(dRequest && "packet" in dRequest && dRequest.packet.attempt === 1);
    assert.equal(f.builder.runOptions[dIndex]?.timeoutMs, 5_400_000);
    assert.equal(f.builder.runOptions[dIndex + 1]?.resumeInterrupted, true, "first timeout gets a fresh continuation");
    assert.deepEqual(summary.implementedRequirementIds, ["D"]);
  });
});

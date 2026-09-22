import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { test } from "node:test";

import { auditPacket } from "../src/judge/audit.js";
import { loadRequirementCatalog } from "../src/catalog.js";
import { auditPackets } from "../src/scheduler.js";
import { RunStateStore } from "../src/run-state.js";
import { PlaywrightProbeRunner } from "../src/judge/playwright-probe-runner.js";
import { probePlanSha256, type ProbePlan } from "../src/judge/probe-schema.js";
import type { PlanCorrection, PlanReview } from "../src/judge/semantic-review.js";
import { FakeProbePlanner } from "./fakes/fake-probe-planner.js";
import { withModulePipeline, type PipelineFixture, fail, pass } from "./helpers/module-pipeline.js";

function groundedPlan(steps: ProbePlan["cases"][number]["steps"], basis = ["Display the main workspace."]): ProbePlan {
  return { packetId: "packet-a", cases: [{ id: "case-A", requirementIds: ["A"], purpose: "happy_path", expectationBasis: basis, steps }] };
}
function correctedReview(plan: ProbePlan, corrections: PlanCorrection[], rationale = "计划与需求冲突"): PlanReview {
  return { status: "corrected", rationale, plan, corrections };
}
function makeState(f: PipelineFixture): RunStateStore {
  return new RunStateStore({ statusByRequirementId: { A: "todo" }, acceptedSha: "checkpoint",
    startedAtMs: 0, totalBudgetMs: 60_000 }, f.options.ledgerFile, f.deps.logSink);
}
async function auditWith(f: PipelineFixture, state: RunStateStore, plan: ProbePlan) {
  const packet = auditPackets(await loadRequirementCatalog(f.options.requirementsFile))[0];
  return auditPacket(packet, plan, f.options, f.deps, state, () => 60_000);
}

test("A seed misread is corrected from requirement evidence, re-run, and only then verified", async () => {
  await withModulePipeline(async f => {
    const original = groundedPlan([{ op: "goto", path: "/" },
      { op: "expectVisible", locator: { by: "role", role: "tab", name: "Archived" } }]);
    const corrected = groundedPlan([{ op: "goto", path: "/" },
      { op: "expectVisible", locator: { by: "role", role: "main" } }]);
    const planner = new FakeProbePlanner([original]);
    planner.reviewPlan = async (_packet, reviewed, failures) => {
      planner.reviews.push({ plan: structuredClone(reviewed), failures: structuredClone(failures) });
      return correctedReview(corrected,
        [{ caseId: "case-A", conflict: "需求写 active 种子，计划断言归档区", basis: ["Display the main workspace."] }]);
    };
    f.deps.planner = planner;
    let runs = 0;
    const executed: ProbePlan[] = [];
    f.deps.runner.run = async plan => { executed.push(plan); return ++runs === 1 ? fail(plan) : pass(plan); };
    const result = await auditWith(f, makeState(f), original);
    assert.equal(result.status, "verified");
    assert.equal(planner.reviews.length, 1);
    assert.equal(executed.length, 2);
    assert.equal(probePlanSha256(executed[1]), probePlanSha256(corrected));
    assert.deepEqual(f.git.restoredShas, []);
    const events = (await f.events()).map(event => event.type);
    assert.ok(events.includes("probe_review_started"));
    assert.ok(events.includes("probe_reviewed"));
  });
});

test("A grounded expectation is reproduced before any failed verdict", async () => {
  await withModulePipeline(async f => {
    const original = groundedPlan([{ op: "goto", path: "/" },
      { op: "expectText", locator: { by: "role", role: "main" }, text: "saved value" }]);
    const planner = new FakeProbePlanner([original]);
    f.deps.planner = planner;
    let runs = 0;
    f.deps.runner.run = async plan => { runs += 1; return fail(plan); };
    const result = await auditWith(f, makeState(f), original);
    assert.equal(result.status, "failed");
    assert.equal(planner.reviews.length, 1);
    assert.equal(runs, 2);
    const reviewed = (await f.events()).find(event => event.type === "probe_reviewed");
    assert.equal(reviewed?.detail?.verdict, "sound");
  });
});

test("Each case accepts at most one semantic correction per run", async () => {
  await withModulePipeline(async f => {
    const original = groundedPlan([{ op: "goto", path: "/" },
      { op: "expectVisible", locator: { by: "role", role: "tab", name: "Archived" } }]);
    const corrected = groundedPlan([{ op: "goto", path: "/" },
      { op: "expectVisible", locator: { by: "role", role: "main" } }]);
    const planner = new FakeProbePlanner([original]);
    planner.reviewPlan = async (_packet, reviewed, failures) => {
      planner.reviews.push({ plan: structuredClone(reviewed), failures: structuredClone(failures) });
      return correctedReview(corrected,
        [{ caseId: "case-A", conflict: "冲突", basis: ["Display the main workspace."] }]);
    };
    f.deps.planner = planner;
    f.deps.runner.run = async plan => fail(plan);
    const state = makeState(f);
    assert.equal((await auditWith(f, state, original)).status, "failed");
    const second = await auditWith(f, state, corrected);
    assert.equal(second.status, "inconclusive");
    assert.match(second.reason ?? "", /quota/);
    assert.equal(planner.reviews.length, 2);
  });
});

test("An unavailable semantic review never becomes a failed verdict", async () => {
  await withModulePipeline(async f => {
    const original = groundedPlan([{ op: "goto", path: "/" },
      { op: "expectText", locator: { by: "role", role: "main" }, text: "saved value" }]);
    const planner = new FakeProbePlanner([original]);
    planner.reviewPlan = async () => { throw new Error("review gateway down"); };
    f.deps.planner = planner;
    f.deps.runner.run = async plan => fail(plan);
    const result = await auditWith(f, makeState(f), original);
    assert.equal(result.status, "inconclusive");
    assert.match(result.reason ?? "", /semantic review/);
    const events = (await f.events()).map(event => event.type);
    assert.ok(events.includes("probe_review_failed"));
  });
});

test("A corrected plan is re-run on the real browser before any verified verdict", async () => {
  await withModulePipeline(async f => {
    const catalog = JSON.parse(await readFile(f.options.requirementsFile, "utf8"));
    catalog.children[0].children[0].description = "Display the main workspace with Sprint goals.";
    await writeFile(f.options.requirementsFile, JSON.stringify(catalog));
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html");
      response.end("<main><ul><li>Sprint goals</li></ul></main>");
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") assert.fail("missing port");
    f.deps.runner = new PlaywrightProbeRunner();
    f.deps.appLifecycle.start = async () => ({ baseUrl: `http://127.0.0.1:${address.port}`, stop: async () => {} });
    try {
      const original = groundedPlan([{ op: "goto", path: "/" },
        { op: "expectText", locator: { by: "role", role: "listitem" }, text: "Archived" }],
        ["Display the main workspace with Sprint goals."]);
      const corrected = groundedPlan([{ op: "goto", path: "/" },
        { op: "expectText", locator: { by: "role", role: "listitem" }, text: "Sprint goals" }],
        ["Sprint goals"]);
      const planner = new FakeProbePlanner([original]);
      planner.reviewPlan = async () => correctedReview(corrected,
        [{ caseId: "case-A", conflict: "种子条目在 active 列表", basis: ["Sprint goals"] }]);
      f.deps.planner = planner;
      const result = await auditWith(f, makeState(f), original);
      assert.equal(result.status, "verified");
      assert.equal(probePlanSha256(result.plan ?? original), probePlanSha256(corrected));
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});

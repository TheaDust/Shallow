import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createServer } from "node:http";
import { test } from "node:test";
import { auditPacket } from "../src/judge/audit.js";
import { loadRequirementCatalog } from "../src/catalog.js";
import { auditPackets } from "../src/scheduler.js";
import { RunStateStore } from "../src/run-state.js";
import { ExecutionFault } from "../src/execution-fault.js";
import { PlaywrightProbeRunner } from "../src/judge/playwright-probe-runner.js";
import { ProbePlannerError } from "../src/judge/llm-probe-planner.js";
import { probePlanSha256, type ProbePlan } from "../src/judge/probe-schema.js";
import { FakeProbePlanner } from "./fakes/fake-probe-planner.js";
import { withModulePipeline, type PipelineFixture, fail, pass, testPlan } from "./helpers/module-pipeline.js";

async function audit(f: PipelineFixture, remaining: () => number = () => 60_000) {
  const packet = auditPackets(await loadRequirementCatalog(f.options.requirementsFile))[0];
  const state = new RunStateStore({ statusByRequirementId: { A: "todo" }, acceptedSha: "checkpoint",
    startedAtMs: 0, totalBudgetMs: 60_000 }, f.options.ledgerFile, f.deps.logSink);
  return auditPacket(packet, undefined, f.options, f.deps, state, remaining);
}
function homePlan(role = "tab"): ProbePlan {
  return { packetId: "packet-a", cases: [{ id: "case-A", requirementIds: ["A"], purpose: "happy_path",
    steps: [{ op: "goto", path: "/" }, { op: "expectVisible", locator: { by: "role", role, name: role === "button" ? "home" : "Home",
      ...(role === "button" ? { exact: true } : { fallbacks: [{ by: "text", text: "Home" }] }) } }] }] };
}

for (const first of ["unchanged", "ambiguous"] as const) {
  test(`Locator ambiguity recovers after ${first} refinement in Chromium, keeping evidence private`, async () => {
    await withModulePipeline(async f => {
      const server = createServer((_request, response) => { response.setHeader("content-type", "text/html");
        response.end('<nav><button><span class="private-sidebar">home</span></button></nav><main><ul><li>home</li></ul></main>'); });
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") assert.fail("missing port");
      const original = homePlan();
      const planner = new FakeProbePlanner([original, first === "unchanged" ? original : homePlan("link"), homePlan("button")]);
      f.deps.planner = planner;
      f.deps.runner = new PlaywrightProbeRunner();
      f.deps.appLifecycle.start = async () => ({ baseUrl: `http://127.0.0.1:${address.port}`, stop: async () => {} });
      const logs: string[] = [];
      f.deps.logSink = { write: line => { logs.push(line); } };
      try {
        assert.equal((await audit(f)).status, "verified");
        assert.equal(planner.refinements.length, 2);
        if (first === "unchanged") assert.match(planner.refinements[1].feedback?.validationError ?? "", /new locator candidate/);
        const evidenceDir = join(dirname(f.options.ledgerFile), "evidence");
        const evidence = JSON.parse(await readFile(join(evidenceDir, (await readdir(evidenceDir))[0]), "utf8"));
        assert.equal(evidence.planSha256, probePlanSha256(original));
        assert.equal(evidence.failures[0].locatorAttempts.length, 2);
        assert.doesNotMatch(logs.join(""), /private-sidebar|locatorSnapshot|locatorAttempts|"steps"/);
        assert.equal(f.builder.requests.length, 0);
        assert.deepEqual(f.git.restoredShas, []);
      } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
    });
  });
}

test("Unchanged, mutated behavior, and fatal refinements never rerun invalid plans", async () => {
  for (const invalid of ["unchanged", "behavior", "fatal"] as const) {
    await withModulePipeline(async f => {
      let runs = 0;
      let refinements = 0;
      f.deps.planner = new FakeProbePlanner([homePlan()]);
      f.deps.planner.refineLocators = async original => {
        refinements++;
        if (invalid === "fatal") throw new ProbePlannerError("transport", "HTTP 401", { httpStatus: 401 });
        if (invalid === "behavior") original.cases[0].steps.pop();
        return original;
      };
      f.deps.runner.run = async plan => { runs++; return fail(plan, "locator"); };
      assert.equal((await audit(f)).status, "inconclusive");
      assert.equal(runs, 1);
      assert.equal(refinements, invalid === "fatal" ? 1 : 2);
      assert.deepEqual(f.git.restoredShas, []);
    });
  }
});

for (const expiration of ["before", "during", "after"] as const) {
  test(`Locator recovery respects phase deadline ${expiration} refinement`, async () => {
    await withModulePipeline(async f => {
      let left = 60_000;
      let runs = 0;
      let refinements = 0;
      f.deps.planner = new FakeProbePlanner([homePlan()]);
      f.deps.planner.refineLocators = async () => { refinements++; if (expiration === "during") left = 0; return homePlan("button"); };
      f.deps.runner.run = async plan => { runs++; if (expiration === "before" || (expiration === "after" && runs === 2)) left = 0; return fail(plan, "locator"); };
      assert.equal((await audit(f, () => left)).status, "inconclusive");
      assert.equal(refinements, expiration === "before" ? 0 : 1);
      assert.equal(runs, expiration === "after" ? 2 : 1);
    });
  });
}

test("Mixed locator/assertion failures refine locators before confirming business failures", async () => {
  await withModulePipeline(async f => {
    const original = homePlan();
    original.cases.push({ ...original.cases[0], id: "business" });
    const refined = structuredClone(original);
    const step = refined.cases[0].steps[1];
    if (step.op === "expectVisible") step.locator = { by: "role", role: "button", name: "Home" };
    const planner = new FakeProbePlanner([original, refined]);
    f.deps.planner = planner;
    let runs = 0;
    f.deps.runner.run = async plan => {
      runs++;
      const report = fail(plan);
      report.failures[0].caseId = "business";
      if (runs === 1) report.failures.push(fail(plan, "locator").failures[0]);
      return report;
    };
    assert.equal((await audit(f)).status, "failed");
    assert.equal(runs, 3);
    assert.equal(planner.refinements[0].failures.length, 1);
    assert.equal(planner.refinements[0].failures[0].category, "locator");
  });
});

test("Browser retry is bounded and does not consume a Builder call", async () => {
  for (const recover of [true, false]) await withModulePipeline(async f => {
    let runs = 0;
    f.deps.runner.run = async plan => {
      if (++runs === 1 || !recover) throw new ExecutionFault("browser", "browser_disconnected", true);
      return pass(plan);
    };
    assert.equal((await audit(f)).status, recover ? "verified" : "inconclusive");
    assert.equal(runs, 2);
    assert.equal(f.builder.requests.length, 0);
  });
});

test("Planner invalid output gets scoped validation feedback and the remaining timeout", async () => {
  await withModulePipeline(async f => {
    let calls = 0;
    f.deps.planner.plan = async (packet, feedback, options) => {
      calls++;
      assert.equal(options?.timeoutMs, 1234);
      if (calls === 1) throw new ProbePlannerError("schema", "invalid", { cause: new Error("missing assertion") });
      assert.equal(feedback?.validationError, "missing assertion");
      return testPlan(packet);
    };
    assert.equal((await audit(f, () => 1234)).status, "verified");
    assert.equal(calls, 2);
  });
});

import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createServer } from "node:http";
import { test } from "node:test";
import { auditPacket, type AuditPolicy } from "../src/judge/audit.js";
import { loadRequirementCatalog } from "../src/catalog.js";
import { auditPackets } from "../src/scheduler.js";
import { RunStateStore } from "../src/run-state.js";
import { ExecutionFault } from "../src/execution-fault.js";
import { PlaywrightProbeRunner } from "../src/judge/playwright-probe-runner.js";
import { ProbePlannerError } from "../src/judge/llm-probe-planner.js";
import { probePlanSha256, type ProbePlan } from "../src/judge/probe-schema.js";
import { rootSearchNavigationPlan } from "../src/judge/navigation-recovery.js";
import { FakeProbePlanner } from "./fakes/fake-probe-planner.js";
import { withModulePipeline, type PipelineFixture, fail, pass, testPlan } from "./helpers/module-pipeline.js";

async function audit(f: PipelineFixture, remaining: () => number = () => 60_000, policy?: AuditPolicy) {
  const packet = auditPackets(await loadRequirementCatalog(f.options.requirementsFile))[0];
  const state = new RunStateStore({ statusByRequirementId: { A: "todo" }, acceptedSha: "checkpoint",
    startedAtMs: 0, totalBudgetMs: 60_000 }, f.options.ledgerFile, f.deps.logSink);
  return auditPacket(packet, undefined, f.options, f.deps, state, remaining, policy);
}
function homePlan(role = "tab", basis = "Display the main workspace."): ProbePlan {
  return { packetId: "packet-a", cases: [{ id: "case-A", requirementIds: ["A"], purpose: "happy_path",
    expectationBasis: [basis],
    steps: [{ op: "goto", path: "/" }, { op: "expectVisible", locator: { by: "role", role, name: role === "button" ? "home" : "Home",
      ...(role === "button" ? { exact: true } : { fallbacks: [{ by: "text", text: "Home" }] }) } }] }] };
}

for (const mode of ["required", "transient", "guessed", "no-navigation"] as const) {
  test(`Missing controls remain inconclusive and only repeated grounded actions allow diagnosis: ${mode}`, async () => {
    await withModulePipeline(async f => {
      const catalog = JSON.parse(await readFile(f.options.requirementsFile, "utf8"));
      catalog.children[0].children[0].description = 'Open "Items" and click "Publish".';
      await writeFile(f.options.requirementsFile, JSON.stringify(catalog));
      const plan: ProbePlan = { packetId: "packet-a", cases: [{ id: "publish", requirementIds: ["A"], purpose: "happy_path",
        expectationBasis: ['Open "Items" and click "Publish".'], steps: [
        { op: "goto", path: "/" },
        ...(mode === "no-navigation" ? [] : [{ op: "click" as const, locator: { by: "role" as const, role: "button", name: "Items" } }]),
        { op: "click", locator: { by: "role", role: "button", name: mode === "guessed" ? "Unknown" : "Publish" } },
        { op: "expectVisible", locator: { by: "role", role: "status" } },
      ] }] };
      const planner = new FakeProbePlanner([plan]);
      f.deps.planner = planner;
      planner.refineLocators = async original => original;
      let runs = 0;
      f.deps.runner.run = async current => {
        if (++runs === 2 && mode === "transient") return pass(current);
        const report = fail(current, "locator");
        report.failures[0].stepIndex = mode === "no-navigation" ? 1 : 2;
        return report;
      };
      const result = await audit(f);
      assert.equal(result.status, mode === "transient" ? "verified" : "inconclusive");
      assert.equal(result.repairableLocatorFailure === true, mode === "required");
      assert.equal(runs, mode === "required" || mode === "transient" ? 2 : 1);
      assert.equal(f.builder.requests.length, 0);
      assert.equal(planner.reviews.length, 0);
    });
  });
}

for (const first of ["unchanged", "ambiguous"] as const) {
  test(`Locator ambiguity ${first === "unchanged" ? "stops" : "recovers"} after ${first} refinement in Chromium, keeping evidence private`, async () => {
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
        assert.equal((await audit(f)).status, first === "unchanged" ? "inconclusive" : "verified");
        assert.equal(planner.refinements.length, first === "unchanged" ? 1 : 2);
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

test("Audit forwards requirement-declared anchor names to locator refinement", async () => {
  await withModulePipeline(async f => {
    const catalog = JSON.parse(await readFile(f.options.requirementsFile, "utf8"));
    catalog.children[0].children[0].description = 'Show "Home" in the workspace.';
    await writeFile(f.options.requirementsFile, JSON.stringify(catalog));
    const planner = new FakeProbePlanner([homePlan("tab", 'Show "Home" in the workspace.'),
      homePlan("button", 'Show "Home" in the workspace.')]);
    f.deps.planner = planner;
    let runs = 0;
    f.deps.runner.run = async plan => { runs += 1; return runs === 1 ? fail(plan, "locator") : pass(plan); };
    assert.equal((await audit(f)).status, "verified");
    assert.deepEqual(planner.refinements[0].anchoredNames, ["Home"]);
  });
});

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
      assert.equal(refinements, invalid === "behavior" ? 2 : 1);
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

test("Detection-only audits skip locator refinement but still run the probes", async () => {
  await withModulePipeline(async f => {
    let runs = 0;
    let refinements = 0;
    const planner = new FakeProbePlanner([homePlan()]);
    f.deps.planner = planner;
    planner.refineLocators = async original => { refinements++; return homePlan("button"); };
    f.deps.runner.run = async plan => { runs++; return fail(plan, "locator"); };
    assert.equal((await audit(f, () => 60_000, { refineLocators: false })).status, "inconclusive");
    assert.equal(runs, 1);
    assert.equal(refinements, 0);
    assert.equal(planner.reviews.length, 0);
    assert.deepEqual(f.git.restoredShas, []);
  });
});

test("A missing seeded link can be reached through visible search and must pass again on a fresh app", async () => {
  await withModulePipeline(async f => {
    const catalog = JSON.parse(await readFile(f.options.requirementsFile, "utf8"));
    catalog.children[0].children[0].description = "Seed data: repository `acme-docs`. A search result opens the repository. Opening the repository shows Issues.";
    await writeFile(f.options.requirementsFile, JSON.stringify(catalog));
    const plan: ProbePlan = { packetId: "packet-a", cases: [{ id: "issues", requirementIds: ["A"], purpose: "happy_path",
      expectationBasis: ["Opening the repository shows Issues."], steps: [
        { op: "goto", path: "/" },
        { op: "click", locator: { by: "role", role: "link", name: "acme-docs", exact: true } },
        { op: "expectVisible", locator: { by: "role", role: "link", name: "Issues", exact: true } },
      ] }] };
    f.deps.planner = new FakeProbePlanner([plan]);
    let launches = 0;
    const originalStart = f.deps.appLifecycle.start.bind(f.deps.appLifecycle);
    f.deps.appLifecycle.start = async (...args) => { launches++; return originalStart(...args); };
    let runs = 0;
    f.deps.runner.run = async current => {
      runs++;
      if (runs === 1) {
        const report = fail(current, "locator");
        report.failures[0].locatorSnapshot = '- searchbox "Search"\n- link "Sign in"';
        return report;
      }
      assert.deepEqual(current.cases[0].steps.slice(1, 3), [
        { op: "fill", locator: { by: "role", role: "searchbox", name: "Search", exact: true }, value: "acme-docs" },
        { op: "press", locator: { by: "role", role: "searchbox", name: "Search", exact: true }, key: "Enter" },
      ]);
      assert.deepEqual(current.cases[0].steps.slice(3), plan.cases[0].steps.slice(1));
      return pass(current);
    };
    const result = await audit(f);
    assert.equal(result.status, "verified");
    assert.equal(runs, 3);
    assert.equal(launches, 2);
    assert.equal((await f.events()).filter(event => event.type === "probe_navigation_attempted").length, 1);
  });
});

test("The same plan, failed step, and page snapshot do not repeat a no-progress refinement", async () => {
  await withModulePipeline(async f => {
    let refinements = 0;
    let probes = 0;
    let snapshot = '- main "Workspace"';
    f.deps.planner.plan = async () => homePlan();
    f.deps.planner.refineLocators = async original => { refinements++; return original; };
    f.deps.runner.run = async plan => {
      probes++;
      const report = fail(plan, "locator");
      report.failures[0].locatorSnapshot = snapshot;
      return report;
    };
    const policy: AuditPolicy = { refineLocators: true, noProgressRefinements: new Set<string>() };
    assert.equal((await audit(f, () => 60_000, policy)).status, "inconclusive");
    assert.equal((await audit(f, () => 60_000, policy)).status, "inconclusive");
    assert.equal(probes, 2);
    assert.equal(refinements, 1);
    assert.equal(policy.noProgressRefinements?.size, 1);
    snapshot = '- main "Updated Workspace"';
    assert.equal((await audit(f, () => 60_000, policy)).status, "inconclusive");
    assert.equal(refinements, 2);
  });
});

test("Partial search navigation keeps the improved plan and evidence for the next audit", async () => {
  await withModulePipeline(async f => {
    const catalog = JSON.parse(await readFile(f.options.requirementsFile, "utf8"));
    catalog.children[0].children[0].description = "Seed data: repository `acme-docs`. A search result opens the repository. Opening it shows Issues.";
    await writeFile(f.options.requirementsFile, JSON.stringify(catalog));
    const plan: ProbePlan = { packetId: "packet-a", cases: ["list", "detail"].map(id => ({
      id, requirementIds: ["A"], purpose: "happy_path" as const,
      expectationBasis: ["Opening it shows Issues."], steps: [
        { op: "goto" as const, path: "/" },
        { op: "click" as const, locator: { by: "role" as const, role: "link", name: "acme-docs", exact: true } },
        { op: "expectVisible" as const, locator: { by: "role" as const, role: "link", name: "Issues" } },
      ],
    })) };
    f.deps.planner = new FakeProbePlanner([plan]);
    f.deps.runner.run = async current => current.cases[0].steps.length === 3 ? {
      packetId: current.packetId, verdict: "inconclusive", passedCases: [],
      failures: current.cases.map(item => ({ caseId: item.id, stepIndex: 1,
        category: "locator" as const, message: "missing home link", locatorSnapshot: '- searchbox "Search"' })),
    } : {
      packetId: current.packetId, verdict: "inconclusive", passedCases: ["list"],
      failures: [{ caseId: "detail", stepIndex: 4, category: "locator", message: "missing detail control",
        locatorSnapshot: '- link "Issues"' }],
    };
    const result = await audit(f, () => 60_000, { refineLocators: false });
    assert.equal(result.status, "inconclusive");
    assert.deepEqual(result.report?.passedCases, ["list"]);
    assert.equal(result.plan?.cases[0].steps.length, 5);
    const attempted = (await f.events()).find(event => event.type === "probe_navigation_attempted");
    assert.equal(attempted?.detail?.improved, true);
    assert.equal(attempted?.detail?.recovered, false);
  });
});

test("Chromium recovers a seeded repository entry through the visible searchbox", async () => {
  await withModulePipeline(async f => {
    const catalog = JSON.parse(await readFile(f.options.requirementsFile, "utf8"));
    catalog.children[0].children[0].description = "Seed data: repository `acme-docs`. A search result opens the repository. Opening the repository shows Issues.";
    await writeFile(f.options.requirementsFile, JSON.stringify(catalog));
    const plan: ProbePlan = { packetId: "packet-a", cases: [{ id: "issues", requirementIds: ["A"], purpose: "happy_path",
      expectationBasis: ["Opening the repository shows Issues."], steps: [
        { op: "goto", path: "/" },
        { op: "click", locator: { by: "role", role: "link", name: "acme-docs", exact: true } },
        { op: "expectVisible", locator: { by: "role", role: "link", name: "Issues", exact: true } },
      ] }] };
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      response.setHeader("content-type", "text/html");
      response.end(url.pathname === "/repo" ? '<a href="/issues">Issues</a>'
        : `<form action="/"><input type="search" aria-label="Search" name="q"></form>${url.searchParams.get("q") === "acme-docs" ? '<a href="/repo">acme-docs</a>' : ""}`);
    });
    await new Promise<void>(resolvePromise => server.listen(0, "127.0.0.1", resolvePromise));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      f.deps.planner = new FakeProbePlanner([plan]);
      f.deps.runner = new PlaywrightProbeRunner();
      f.deps.appLifecycle.start = async () => ({ baseUrl: `http://127.0.0.1:${address.port}`, stop: async () => {} });
      const result = await audit(f);
      assert.equal(result.status, "verified");
      assert.equal(result.plan?.cases[0].steps.length, plan.cases[0].steps.length + 2);
    } finally {
      await new Promise<void>(resolvePromise => server.close(() => resolvePromise()));
    }
  });
});

test("Search navigation is unavailable without a seeded target or a unique visible searchbox", async () => {
  await withModulePipeline(async f => {
    const packet = auditPackets(await loadRequirementCatalog(f.options.requirementsFile))[0];
    const plan: ProbePlan = { packetId: packet.id, cases: [{ id: "entry", requirementIds: ["A"], purpose: "happy_path",
      expectationBasis: ["Display the main workspace."], steps: [
        { op: "goto", path: "/" }, { op: "click", locator: { by: "role", role: "link", name: "acme-docs" } },
        { op: "expectVisible", locator: { by: "role", role: "main" } },
      ] }] };
    const report = fail(plan, "locator");
    report.failures[0].locatorSnapshot = '- searchbox "Search"';
    assert.equal(rootSearchNavigationPlan(packet, plan, report), undefined);
    packet.requirements[0].seedDeclarations = ["Seed data: repository `acme-docs`."];
    packet.requirements[0].text = "A search result opens the repository.";
    report.failures[0].locatorSnapshot = '- searchbox "Search"\n- searchbox "Search code"';
    assert.equal(rootSearchNavigationPlan(packet, plan, report), undefined);
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

test("A model-length-truncated plan gets one compact retry", async () => {
  await withModulePipeline(async f => {
    let calls = 0;
    f.deps.planner.plan = async (packet, feedback) => {
      calls++;
      if (calls === 1) throw new ProbePlannerError("response", "Probe planner response body failed",
        { cause: new SyntaxError("Probe planner stream was cut off by the model") });
      assert.equal(feedback?.validationError, "Probe planner stream was cut off by the model");
      return testPlan(packet);
    };
    assert.equal((await audit(f)).status, "verified");
    assert.equal(calls, 2);
    assert.equal((await f.events()).filter(event => event.type === "probe_planner_retry").length, 1);
  });
});

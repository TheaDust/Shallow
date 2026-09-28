import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { chromium } from "@playwright/test";
import { auditPacket } from "../../src/judge/audit.js";
import { loadRequirementCatalog } from "../../src/catalog.js";
import { auditPackets } from "../../src/scheduler.js";
import { RunStateStore } from "../../src/run-state.js";
import { PlaywrightProbeRunner } from "../../src/judge/playwright-probe-runner.js";
import type { ProbePlan } from "../../src/judge/probe-schema.js";
import { toBuilderShadowObservation } from "../../src/builder/shadow-observation.js";
import { withModulePipeline } from "../helpers/module-pipeline.js";
import { FakeProbePlanner } from "../fakes/fake-probe-planner.js";

test("Independent cases reset server data while reload keeps the current case data and one browser", async () => {
  await withModulePipeline(async f => {
    const catalog = JSON.parse(await readFile(f.options.requirementsFile, "utf8"));
    catalog.children[0].children[0].description = "Adding a record changes the count from zero to one and persists after reload.";
    await writeFile(f.options.requirementsFile, JSON.stringify(catalog));
    const packet = auditPackets(await loadRequirementCatalog(f.options.requirementsFile))[0];
    let count = 0;
    let starts = 0;
    let stops = 0;
    let browsers = 0;
    const server = createServer((request, response) => {
      if (request.method === "POST") {
        response.end(String(++count));
      } else {
        response.setHeader("content-type", "text/html");
        response.end(`<button onclick="fetch('/add',{method:'POST'}).then(r=>r.text()).then(v=>document.querySelector('output').textContent=v)">Add</button><output role="status">${count}</output>`);
      }
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const baseUrl = `http://127.0.0.1:${address.port}`;
      f.deps.appLifecycle.start = async () => {
        count = 0;
        starts++;
        return { baseUrl, stop: async () => { stops++; } };
      };
      f.deps.runner = new PlaywrightProbeRunner(async () => { browsers++; return chromium.launch({ headless: true }); });
      const plan: ProbePlan = { packetId: packet.id, cases: ["first", "second"].map(id => ({
        id, requirementIds: ["A"], purpose: "persistence", expectationBasis: [catalog.children[0].children[0].description],
        setupStepCount: 2, steps: [
          { op: "goto", path: "/" },
          { op: "expectText", locator: { by: "role", role: "status" }, text: "0" },
          { op: "click", locator: { by: "role", role: "button", name: "Add", exact: true } },
          { op: "expectText", locator: { by: "role", role: "status" }, text: "1" },
          { op: "reload" },
          { op: "expectText", locator: { by: "role", role: "status" }, text: "1" },
        ],
      })) };
      const state = new RunStateStore({ statusByRequirementId: { A: "todo" }, acceptedSha: "baseline",
        startedAtMs: 0, totalBudgetMs: 60_000 }, f.options.ledgerFile);
      const result = await auditPacket(packet, plan, f.options, f.deps, state, () => 60_000);
      assert.equal(result.status, "verified");
      assert.deepEqual(result.report?.passedCases, ["first", "second"]);
      assert.equal(starts, 2);
      assert.equal(stops, 2);
      assert.equal(browsers, 1);
      assert.equal(count, 1);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});

test("Preparation mismatch stops the target operation and file feedback exposes input shape only", async () => {
  let writes = 0;
  const server = createServer((request, response) => {
    if (request.method === "POST") writes++;
    response.setHeader("content-type", "text/html");
    response.end(`<label>CSV file<input type="file"></label><button onclick="fetch('/write',{method:'POST'})">Write</button><output role="status">0</output>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const options = { baseUrl: `http://127.0.0.1:${address.port}`, stepTimeoutMs: 250, caseTimeoutMs: 5_000 };
    const plan: ProbePlan = { packetId: "prepare", cases: [{ id: "wrong-seed", requirementIds: ["A"], purpose: "happy_path",
      expectationBasis: ["fixture"], setupStepCount: 2, steps: [
        { op: "goto", path: "/" },
        { op: "expectText", locator: { by: "role", role: "status" }, text: "1" },
        { op: "click", locator: { by: "role", role: "button", name: "Write" } },
        { op: "expectText", locator: { by: "role", role: "status" }, text: "2" },
      ] }] };
    const runner = new PlaywrightProbeRunner();
    const preparation = await runner.run(plan, options);
    assert.equal(preparation.verdict, "inconclusive");
    assert.equal(preparation.failures[0].category, "precondition");
    assert.equal(writes, 0);
    plan.cases[0].setupStepCount = undefined;
    plan.cases[0].steps = [
      { op: "goto", path: "/" },
      { op: "uploadFile", locator: { by: "label", text: "CSV file" }, fileName: "data.csv", content: "Name,Value\nEast,1200" },
      { op: "expectText", locator: { by: "role", role: "status" }, text: "2" },
    ];
    const failure = await runner.run(plan, options);
    assert.equal(failure.failures[0].category, "assertion");
    const feedback = toBuilderShadowObservation(failure);
    assert.match(feedback.failures[0].inputSummary!, /换行符 1 个；文件末尾无换行/);
    assert.ok(!JSON.stringify(feedback).includes("East,1200"));
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("Missing results are assertion failures while ambiguous targets remain locator failures", async () => {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end('<button>Save</button><h2>Result</h2><h2>Result</h2><output role="status">Unchanged</output>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const plan: ProbePlan = { packetId: "results", cases: ["missing", "ambiguous", "wrong-value"].map(id => ({
      id, requirementIds: ["A"], purpose: "happy_path", expectationBasis: ["fixture"], steps: [
        { op: "goto", path: "/" },
        { op: "click", locator: { by: "role", role: "button", name: "Save", exact: true } },
        id === "wrong-value"
          ? { op: "expectText", locator: { by: "role", role: "status" }, text: "Saved" }
          : { op: "expectVisible", locator: { by: "role", role: "heading", name: id === "missing" ? "New record" : "Result", exact: true } },
      ],
    })) };
    const result = await new PlaywrightProbeRunner().run(plan, { baseUrl: `http://127.0.0.1:${address.port}`,
      stepTimeoutMs: 250, caseTimeoutMs: 5000 });
    assert.deepEqual(result.failures.map(item => item.category), ["assertion", "locator", "assertion"]);
    assert.ok(result.failures.every(item => item.locatorSnapshot?.includes('status: Unchanged')));
    assert.match(result.failures[2].locatorSnapshot!, /^- status: Unchanged/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("A missing menu-opening step uses both recovery calls for plan validation and reconstruction", async () => {
  await withModulePipeline(async f => {
    const catalog = JSON.parse(await readFile(f.options.requirementsFile, "utf8"));
    const basis = 'Open "Account menu", then "Items", and click "Publish" to display "Published".';
    catalog.children[0].children[0].description = basis;
    await writeFile(f.options.requirementsFile, JSON.stringify(catalog));
    const packet = auditPackets(await loadRequirementCatalog(f.options.requirementsFile))[0];
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html");
      response.end('<button onclick="document.querySelector(\'#items\').hidden=false">Account menu</button>' +
        '<button id="items" hidden onclick="document.querySelector(\'#publish\').hidden=false">Items</button>' +
        '<button id="publish" hidden onclick="document.querySelector(\'output\').textContent=\'Published\'">Publish</button><output role="status"></output>');
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      // Items is absent from the accessible tree until the menu is opened.
      const original: ProbePlan = { packetId: packet.id, cases: [{ id: "publish", requirementIds: ["A"], purpose: "happy_path",
        expectationBasis: [basis], steps: [
          { op: "goto", path: "/" },
          { op: "click", locator: { by: "role", role: "button", name: "Items", exact: true } },
          { op: "click", locator: { by: "role", role: "button", name: "Publish", exact: true } },
          { op: "expectText", locator: { by: "role", role: "status" }, text: "Published" },
        ] }] };
      const corrected = structuredClone(original);
      corrected.cases[0].steps.splice(1, 0, { op: "click", locator: { by: "role", role: "button", name: "Account menu", exact: true } });
      const planner = new FakeProbePlanner([original]);
      planner.reviewPlan = async (_packet, plan, failures) => {
        planner.reviews.push({ plan, failures });
        if (planner.reviews.length === 1) throw new Error("Invalid review locator: hasText must be inside scope");
        return { status: "corrected", rationale: "The requirement supplies the missing menu entry",
          corrections: [{ caseId: "publish", conflict: "The menu was never opened", basis: [basis] }], plan: corrected };
      };
      f.deps.planner = planner;
      f.deps.runner = new PlaywrightProbeRunner();
      f.deps.appLifecycle.start = async () => ({ baseUrl: `http://127.0.0.1:${address.port}`, stop: async () => {} });
      const state = new RunStateStore({ statusByRequirementId: { A: "todo" }, acceptedSha: "baseline",
        startedAtMs: 0, totalBudgetMs: 60_000 }, f.options.ledgerFile);
      const result = await auditPacket(packet, original, f.options, f.deps, state, () => 60_000);
      assert.equal(result.status, "verified");
      assert.equal(planner.refinements.length, 0);
      assert.equal(planner.reviews.length, 2);
      assert.deepEqual(result.plan?.cases[0].steps.slice(2), original.cases[0].steps.slice(1));
      assert.equal(f.builder.requests.length, 0);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});

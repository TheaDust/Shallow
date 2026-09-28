import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { PlaywrightProbeRunner } from "../../src/judge/playwright-probe-runner.js";
import { parseProbePlan, toWireProbePlan, type ProbePlan } from "../../src/judge/probe-schema.js";

test("State probes reject no-op toggles and visible fallbacks in Chromium", async () => {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(`<button aria-expanded="true" onclick="${request.url === "/broken" ? "" : "this.setAttribute('aria-expanded', String(this.getAttribute('aria-expanded') !== 'true')); document.querySelector('aside').hidden = this.getAttribute('aria-expanded') === 'false'"}">Toggle</button><aside>Tools</aside>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") assert.fail("missing address");
    const run = (plan: ProbePlan) => new PlaywrightProbeRunner().run(plan, {
      baseUrl: `http://127.0.0.1:${address.port}`, stepTimeoutMs: 300, caseTimeoutMs: 5_000,
    });
    const plan: ProbePlan = { packetId: "state", cases: [{ id: "toggle", requirementIds: ["A"], purpose: "happy_path",
      expectationBasis: ["fixture"], steps: [
      { op: "goto", path: "/" },
      { op: "click", locator: { by: "role", role: "button", name: "Toggle" } },
      { op: "expectAttribute", locator: { by: "role", role: "button", name: "Toggle" }, attribute: "aria-expanded", value: "false" },
      { op: "expectHidden", locator: { by: "role", role: "complementary" } },
      { op: "click", locator: { by: "role", role: "button", name: "Toggle" } },
      { op: "expectAttribute", locator: { by: "role", role: "button", name: "Toggle" }, attribute: "aria-expanded", value: "true" },
      { op: "expectVisible", locator: { by: "role", role: "complementary" } },
    ] }] };
    assert.equal((await run(plan)).verdict, "pass");
    plan.cases[0].steps[0] = { op: "goto", path: "/broken" };
    const broken = await run(plan);
    assert.equal(broken.verdict, "fail");
    assert.equal(broken.failures[0].category, "assertion");
    assert.equal(broken.failures[0].stepIndex, 2);
    plan.cases[0].steps = [{ op: "goto", path: "/" }, { op: "expectHidden", locator: {
      by: "role", role: "dialog", fallbacks: [{ by: "role", role: "complementary" }],
    } }];
    assert.equal((await run(plan)).verdict, "fail");
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("Enabled-state probes verify undo transitions, inherited disabling and ARIA in Chromium", async () => {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(`<button id="redo" disabled>Redo</button>
      <button onclick="document.getElementById('redo').disabled=false">Undo</button>
      <input aria-label="Editor" oninput="document.getElementById('redo').disabled=true">
      <fieldset disabled><button>Inherited block</button></fieldset>
      <div role="button" aria-disabled="true">ARIA action</div>
      <button style="opacity:.3;pointer-events:none">Fake disabled</button>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") assert.fail("missing address");
    const control = (name: string) => ({ by: "role" as const, role: "button", name, exact: true });
    const plan: ProbePlan = { packetId: "enabled-state", cases: [{
      id: "undo-new-edit", requirementIds: ["A"], purpose: "happy_path", expectationBasis: ["fixture"], steps: [
        { op: "goto", path: "/" },
        { op: "expectVisible", locator: control("Redo") },
        { op: "expectDisabled", locator: control("Redo") },
        { op: "expectDisabled", locator: control("Inherited block") },
        { op: "expectDisabled", locator: control("ARIA action") },
        { op: "click", locator: control("Undo") },
        { op: "expectEnabled", locator: control("Redo") },
        { op: "fill", locator: { by: "label", text: "Editor", exact: true }, value: "new edit" },
        { op: "expectDisabled", locator: control("Redo") },
      ],
    }, ...[
      ["visual-only", "expectDisabled", "Fake disabled"],
      ["inherited-enabled", "expectEnabled", "Inherited block"],
      ["aria-enabled", "expectEnabled", "ARIA action"],
      ["missing-control", "expectDisabled", "Missing action"],
    ].map(([id, op, name]) => ({ id, requirementIds: ["A"], purpose: "negative" as const, expectationBasis: ["fixture"],
      steps: [{ op: "goto" as const, path: "/" },
        { op: op as "expectDisabled" | "expectEnabled", locator: control(name) }],
    }))] };
    const report = await new PlaywrightProbeRunner().run(parseProbePlan(toWireProbePlan(plan)), {
      baseUrl: `http://127.0.0.1:${address.port}`, stepTimeoutMs: 300, caseTimeoutMs: 5_000,
    });
    assert.deepEqual(report.passedCases, ["undo-new-edit"]);
    assert.equal(report.failures.length, 4);
    assert.ok(report.failures.every(failure => failure.category === "assertion" && failure.stepIndex === 1));
    assert.equal(report.verdict, "fail");
    assert.match(report.failures[0].locatorSnapshot ?? "", /Fake disabled/);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("Visible fallback actions skip hidden text while hidden file inputs remain uploadable", async () => {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(`<span hidden>Save</span><button aria-label="Save" onclick="document.getElementById('result').textContent='Saved'">✓</button>
      <label for="csv">CSV file</label><input hidden id="csv" type="file" onchange="document.getElementById('result').textContent='Uploaded '+this.files[0].name">
      <p id="result" role="status"></p>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") assert.fail("missing address");
    const plan: ProbePlan = { packetId: "visible-candidate", cases: [{
      id: "visible-action", requirementIds: ["A"], purpose: "happy_path", expectationBasis: ["fixture"], steps: [
        { op: "goto", path: "/" },
        { op: "click", locator: { by: "text", text: "Save", exact: true,
          fallbacks: [{ by: "role", role: "button", name: "Save", exact: true }] } },
        { op: "expectText", locator: { by: "role", role: "status" }, text: "Saved" },
      ],
    }, {
      id: "hidden-upload", requirementIds: ["A"], purpose: "happy_path", expectationBasis: ["fixture"], steps: [
        { op: "goto", path: "/" },
        { op: "uploadFile", locator: { by: "label", text: "CSV file", exact: true }, fileName: "records.csv", content: "Name\nAlice" },
        { op: "expectText", locator: { by: "role", role: "status" }, text: "Uploaded records.csv" },
      ],
    }, {
      id: "hidden-only", requirementIds: ["A"], purpose: "negative", expectationBasis: ["fixture"], steps: [
        { op: "goto", path: "/" },
        { op: "click", locator: { by: "text", text: "Save", exact: true } },
        { op: "expectText", locator: { by: "role", role: "status" }, text: "Saved" },
      ],
    }] };
    const report = await new PlaywrightProbeRunner().run(parseProbePlan(toWireProbePlan(plan)), {
      baseUrl: `http://127.0.0.1:${address.port}`, stepTimeoutMs: 300, caseTimeoutMs: 5_000,
    });
    assert.deepEqual(report.passedCases, ["visible-action", "hidden-upload"]);
    assert.equal(report.failures.length, 1);
    assert.equal(report.failures[0].caseId, "hidden-only");
    assert.equal(report.failures[0].category, "locator");
    assert.equal(report.verdict, "inconclusive");
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

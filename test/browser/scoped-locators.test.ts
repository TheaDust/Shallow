import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { PlaywrightProbeRunner } from "../../src/judge/playwright-probe-runner.js";

test("Label-based selection excludes a same-named region and still rejects two matching selects", async () => {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    const select = '<label for="branch">Default branch</label><select id="branch"><option>main</option><option>release</option></select>';
    response.end(`<main><section aria-label="Default branch">${select}</section>${
      request.url === "/ambiguous" ? select.replaceAll('"branch"', '"second-branch"') : ""}</main>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") assert.fail("missing address");
    const run = (path: string) => new PlaywrightProbeRunner().run({ packetId: "select", cases: [{
      id: "choose", requirementIds: ["A"], purpose: "happy_path", expectationBasis: ["fixture"], steps: [
        { op: "goto", path },
        { op: "select", locator: { by: "label", text: "Default branch", exact: true }, value: "release" },
        { op: "expectValue", locator: { by: "label", text: "Default branch", exact: true }, value: "release" },
      ],
    }] }, { baseUrl: `http://127.0.0.1:${address.port}`, stepTimeoutMs: 500, caseTimeoutMs: 5_000 });
    assert.equal((await run("/")).verdict, "pass");
    const ambiguous = await run("/ambiguous");
    assert.equal(ambiguous.verdict, "inconclusive");
    assert.equal(ambiguous.failures[0].locatorAttempts?.[0].matchCount, 2);
    assert.match(ambiguous.failures[0].message, /strict mode violation/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
import { parseProbePlan } from "../../src/judge/probe-schema.js";

test("Ambiguous targets retain their URL, match count and object containers after a large unrelated view", async () => {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(`<main><div role="grid">${Array.from({ length: 250 }, (_, i) => `<div role="row"><span role="gridcell">Cell ${i}</span></div>`).join("")}</div></main>
      <section role="region" aria-label="Repository"><p>alice/docs</p><button>Search</button></section>
      <section role="region" aria-label="Organization"><p>Acme Demo</p><button>Search</button>
        <label>Password<input type="password" value="private-fixture-value"></label><p>private-fixture-value</p>
        <span hidden>INTERNAL_INVISIBLE</span><script>const internalOnly="SOURCE_NOT_OBSERVABLE";</script></section>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const plan = parseProbePlan({ packetId: "ambiguous", cases: [{ id: "search", requirementIds: ["A"], purpose: "happy_path",
      expectationBasis: ["fixture"], steps: [{ op: "goto", path: "/nested#/files?token=private-url-value" },
        { op: "click", locator: { by: "role", role: "button", name: "Search", exact: true } }],
      assertion: { op: "expectVisible", locator: { by: "role", role: "main" } } }] });
    const report = await new PlaywrightProbeRunner().run(plan, { baseUrl: `http://127.0.0.1:${address.port}`,
      stepTimeoutMs: 1_000, caseTimeoutMs: 5_000 });
    const failure = report.failures[0];
    assert.equal(failure.category, "locator");
    assert.equal(failure.locatorAttempts?.[0].matchCount, 2);
    assert.match(failure.pageUrl ?? "", /nested#\/files/);
    assert.doesNotMatch(failure.pageUrl ?? "", /private-url-value/);
    assert.match(failure.locatorSnapshot ?? "", /alice\/docs/);
    assert.match(failure.locatorSnapshot ?? "", /Acme Demo/);
    assert.match(failure.locatorSnapshot ?? "", /Repository/);
    assert.match(failure.locatorSnapshot ?? "", /Organization/);
    assert.doesNotMatch(failure.locatorSnapshot ?? "", /private-fixture-value/);
    assert.doesNotMatch(failure.locatorSnapshot ?? "", /SOURCE_NOT_OBSERVABLE|INTERNAL_INVISIBLE/);
    assert.ok((failure.locatorSnapshot?.length ?? 0) <= 4_000);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("Scoped accessible locators select the correct repeated card and count multiple matches", async () => {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(`<main><article><h2>Alpha note</h2><button onclick="document.querySelector('[role=status]').textContent='Alpha selected'">More</button></article>
      <article><h2>Beta note</h2><button onclick="document.querySelector('[role=status]').textContent='Beta selected'">More</button></article><div role="status"></div></main>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") assert.fail("missing port");
  try {
    const plan = parseProbePlan({ packetId: "cards", cases: [{ id: "select-beta", requirementIds: ["req"], purpose: "happy_path",
      expectationBasis: ["fixture"], steps: [{ op: "goto", path: "/" },
        { op: "expectCount", locator: { by: "role", role: "button", name: "More" }, count: 2 },
        { op: "click", locator: { by: "role", role: "button", name: "More", scope: { by: "role", role: "article", hasText: "Beta note" } } }],
      assertion: { op: "expectText", locator: { by: "role", role: "status" }, text: "Beta selected" } }] });
    const report = await new PlaywrightProbeRunner().run(plan, { baseUrl: `http://127.0.0.1:${address.port}`, stepTimeoutMs: 1000, caseTimeoutMs: 5000 });
    assert.equal(report.verdict, "pass", JSON.stringify(report.failures));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

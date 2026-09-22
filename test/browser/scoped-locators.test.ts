import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { PlaywrightProbeRunner } from "../../src/judge/playwright-probe-runner.js";
import { parseProbePlan } from "../../src/judge/probe-schema.js";

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

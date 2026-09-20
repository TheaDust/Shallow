import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { PlaywrightProbeRunner } from "../../src/judge/playwright-probe-runner.js";
import type { ProbePlan } from "../../src/judge/probe-schema.js";

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
    const plan: ProbePlan = { packetId: "state", cases: [{ id: "toggle", requirementIds: ["A"], purpose: "happy_path", steps: [
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

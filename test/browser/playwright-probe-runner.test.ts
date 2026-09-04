import assert from "node:assert/strict";
import { test } from "node:test";

import { PlaywrightProbeRunner } from "../../src/judge/playwright-probe-runner.js";
import type { ProbePlan } from "../../src/judge/probe-schema.js";
import { startFixtureServer } from "../helpers/fixture-server.js";

test("Playwright Probe Runner executes fill, click, reload, and assertions in Chromium", async () => {
  const server = await startFixtureServer();
  try {
    const report = await new PlaywrightProbeRunner().run(happyPlan(), {
      baseUrl: server.baseUrl,
      stepTimeoutMs: 2_000,
      caseTimeoutMs: 10_000,
    });

    assert.deepEqual(report, {
      packetId: "packet-profile",
      verdict: "pass",
      passedCases: ["save-profile", "refresh-profile"],
      failures: [],
    });
  } finally {
    await server.stop();
  }
});

test("Playwright Probe Runner creates a fresh browser context for newContext", async () => {
  const server = await startFixtureServer();
  try {
    const plan: ProbePlan = {
      packetId: "packet-context",
      cases: [
        {
          id: "replace-context",
          requirementIds: ["REQ-CONTEXT"],
          purpose: "persistence",
          steps: [
            { op: "goto", path: "/" },
            { op: "newContext", actor: "second-user" },
            { op: "goto", path: "/" },
            {
              op: "expectVisible",
              locator: { by: "role", role: "button", name: "Save" },
            },
          ],
        },
      ],
    };

    const report = await new PlaywrightProbeRunner().run(plan, {
      baseUrl: server.baseUrl,
      stepTimeoutMs: 2_000,
      caseTimeoutMs: 10_000,
    });

    assert.equal(report.verdict, "pass");
  } finally {
    await server.stop();
  }
});

test("Playwright Probe Runner classifies a wrong assertion as fail", async () => {
  const server = await startFixtureServer();
  try {
    const plan = happyPlan();
    plan.cases = [
      {
        id: "wrong-value",
        requirementIds: ["REQ-PROFILE"],
        purpose: "happy_path",
        steps: [
          { op: "goto", path: "/" },
          {
            op: "expectValue",
            locator: { by: "label", text: "Profile name" },
            value: "Never saved",
          },
        ],
      },
    ];

    const report = await new PlaywrightProbeRunner().run(plan, {
      baseUrl: server.baseUrl,
      stepTimeoutMs: 100,
      caseTimeoutMs: 1_000,
    });

    assert.equal(report.verdict, "fail");
    assert.equal(report.failures[0].category, "assertion");
    assert.equal(report.failures[0].stepIndex, 1);
  } finally {
    await server.stop();
  }
});

test("Playwright Probe Runner returns inconclusive with an aria snapshot for a missing locator", async () => {
  const server = await startFixtureServer();
  try {
    const plan = happyPlan();
    plan.cases = [
      {
        id: "missing-control",
        requirementIds: ["REQ-PROFILE"],
        purpose: "happy_path",
        steps: [
          { op: "goto", path: "/" },
          {
            op: "click",
            locator: { by: "role", role: "button", name: "Missing button" },
          },
        ],
      },
    ];

    const report = await new PlaywrightProbeRunner().run(plan, {
      baseUrl: server.baseUrl,
      stepTimeoutMs: 100,
      caseTimeoutMs: 1_000,
    });

    assert.equal(report.verdict, "inconclusive");
    assert.equal(report.failures[0].category, "locator");
    assert.match(report.failures[0].locatorSnapshot ?? "", /Profile name|Save/);
    assert.ok((report.failures[0].locatorSnapshot?.length ?? 0) <= 4_000);
  } finally {
    await server.stop();
  }
});

test("Playwright Probe Runner rejects navigation away from the configured origin", async () => {
  const server = await startFixtureServer();
  try {
    const plan: ProbePlan = {
      packetId: "packet-navigation",
      cases: [
        {
          id: "cross-origin",
          requirementIds: ["REQ-NAV"],
          purpose: "negative",
          steps: [{ op: "goto", path: "https://example.com" }],
        },
      ],
    };

    const report = await new PlaywrightProbeRunner().run(plan, {
      baseUrl: server.baseUrl,
      stepTimeoutMs: 100,
      caseTimeoutMs: 1_000,
    });

    assert.equal(report.verdict, "fail");
    assert.equal(report.failures[0].category, "navigation");
  } finally {
    await server.stop();
  }
});

function happyPlan(): ProbePlan {
  return {
    packetId: "packet-profile",
    cases: [
      {
        id: "save-profile",
        requirementIds: ["REQ-PROFILE"],
        purpose: "happy_path",
        steps: [
          { op: "goto", path: "/" },
          {
            op: "fill",
            locator: { by: "label", text: "Profile name" },
            value: "Ada",
          },
          {
            op: "click",
            locator: { by: "role", role: "button", name: "Save" },
          },
          {
            op: "expectText",
            locator: { by: "role", role: "status" },
            text: "Saved",
            exact: true,
          },
        ],
      },
      {
        id: "refresh-profile",
        requirementIds: ["REQ-PROFILE"],
        purpose: "persistence",
        steps: [
          { op: "goto", path: "/" },
          { op: "reload" },
          {
            op: "expectValue",
            locator: { by: "label", text: "Profile name" },
            value: "Ada",
          },
        ],
      },
    ],
  };
}

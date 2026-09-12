import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LlmProbePlanner,
  ProbePlannerError,
} from "../src/judge/llm-probe-planner.js";
import {
  assertLocatorOnlyRefinement,
  parseProbePlan,
  PROBE_PLAN_JSON_SCHEMA,
  type ProbePlan,
} from "../src/judge/probe-schema.js";
import type { SeedDataCategory, WorkPacket } from "../src/types.js";

test("Probe Planner accepts a bounded declarative plan", () => {
  const plan = parseProbePlan(validPlan(), packet());

  assert.equal(plan.packetId, "packet-profile");
  assert.equal(plan.cases.length, 2);
  assert.deepEqual(plan.cases[0].steps[1], {
    op: "fill",
    locator: { by: "label", text: "Profile name", exact: true },
    value: "Ada",
  });
});

test("Probe plans require an assertion per case and coverage of every packet requirement", () => {
  const withoutAssertion = validPlan();
  withoutAssertion.cases[0].steps = [{ op: "goto", path: "/" }];
  assert.throws(() => parseProbePlan(withoutAssertion, packet()), /assertion/);
  assert.throws(() => parseProbePlan(validPlan(), { id: packet().id, requirementIds: ["REQ-PROFILE", "REQ-OMITTED"] }), /REQ-OMITTED/);
});

test("Probe plans support empty inputs and empty-value assertions with strict-schema null optionals", () => {
  const candidate = validPlan();
  candidate.cases[0].steps = [
    { op: "goto", path: "/" },
    { op: "fill", locator: { by: "role", role: "textbox", name: null, exact: null }, value: "" },
    { op: "expectValue", locator: { by: "label", text: "Profile name", exact: null }, value: "" },
    { op: "expectText", locator: { by: "role", role: "status", name: null, exact: null }, text: "", exact: null },
  ];
  const parsed = parseProbePlan(candidate, packet());
  assert.deepEqual(parsed.cases[0].steps[1], { op: "fill", locator: { by: "role", role: "textbox" }, value: "" });
});

test("Wire schema fully describes the DSL and closes every structured-output object", () => {
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const item = value as Record<string, unknown>;
    if (item.type === "object") {
      assert.equal(item.additionalProperties, false);
      assert.deepEqual(item.required, Object.keys(item.properties as object));
      for (const property of Object.values(item.properties as Record<string, Record<string, unknown>>)) {
        assert.ok(property.type || property.$ref || property.anyOf, "each property needs a declared type or union/reference");
      }
    }
    Object.values(item).forEach(visit);
  };
  visit(PROBE_PLAN_JSON_SCHEMA);
  const wire = JSON.stringify(PROBE_PLAN_JSON_SCHEMA);
  assert.match(wire, /"locator"/);
  assert.match(wire, /"expectValue"/);
});

test("Probe plans accept bounded keyboard and pointer actions with enumerated keys", () => {
  const candidate = validPlan();
  candidate.cases[0].steps = [
    { op: "goto", path: "/" },
    { op: "doubleClick", locator: { by: "label", text: "Profile name" } },
    { op: "hover", locator: { by: "role", role: "button", name: "Hint" } },
    { op: "fill", locator: { by: "label", text: "Profile name" }, value: "Ada" },
    { op: "press", locator: { by: "label", text: "Profile name" }, key: "Enter" },
    { op: "expectText", locator: { by: "role", role: "status" }, text: "Saved" },
  ];
  const parsed = parseProbePlan(candidate, packet());
  assert.deepEqual(parsed.cases[0].steps[4], {
    op: "press",
    locator: { by: "label", text: "Profile name" },
    key: "Enter",
  });

  const badKey = validPlan();
  badKey.cases[0].steps = JSON.parse(`[
    {"op": "goto", "path": "/"},
    {"op": "press", "locator": {"by": "label", "text": "Profile name"}, "key": "Control+a"},
    {"op": "expectVisible", "locator": {"by": "role", "role": "status"}}
  ]`);
  assert.throws(() => parseProbePlan(badKey, packet()), /key must be one of/);

  const wire = JSON.stringify(PROBE_PLAN_JSON_SCHEMA);
  assert.match(wire, /"doubleClick"/);
  assert.match(wire, /"hover"/);
  assert.match(wire, /"Enter"/);
});

test("Probe Planner rejects executable, selector, and cross-origin operations", () => {
  const invalidSteps = [
    { op: "evaluate", code: "document.cookie" },
    { op: "click", selector: "#save" },
    { op: "goto", path: "https://example.com" },
    { op: "goto", path: "//example.com/path" },
    { op: "goto", path: "/../secret" },
    { op: "request", url: "/api/private" },
  ];

  for (const step of invalidSteps) {
    const candidate = validPlan();
    candidate.cases[0].steps = [step];
    assert.throws(() => parseProbePlan(candidate, packet()), /ProbePlan/);
  }
});

test("Probe Planner rejects empty, oversized, duplicate, or unrelated cases", () => {
  const empty = validPlan();
  empty.cases = [];
  assert.throws(() => parseProbePlan(empty, packet()), /at least one case/);

  const oversized = validPlan();
  oversized.cases[0].steps = Array.from({ length: 31 }, () => ({ op: "reload" }));
  assert.throws(() => parseProbePlan(oversized, packet()), /at most 30 steps/);

  const duplicate = validPlan();
  duplicate.cases[1].id = duplicate.cases[0].id;
  assert.throws(() => parseProbePlan(duplicate, packet()), /Duplicate case id/);

  const unrelated = validPlan();
  unrelated.cases[0].requirementIds = ["REQ-OTHER"];
  assert.throws(() => parseProbePlan(unrelated, packet()), /outside packet/);
});

test("Probe Planner refinement may change locators but not behavior", () => {
  const original = parseProbePlan(validPlan(), packet());
  const locatorOnly = structuredClone(original);
  const fill = locatorOnly.cases[0].steps[1];
  if (fill.op !== "fill") throw new Error("fixture step must be fill");
  fill.locator = { by: "role", role: "textbox", name: "Profile name" };

  assert.doesNotThrow(() => assertLocatorOnlyRefinement(original, locatorOnly));

  const changedValue = structuredClone(locatorOnly);
  const changedFill = changedValue.cases[0].steps[1];
  if (changedFill.op !== "fill") throw new Error("fixture step must be fill");
  changedFill.value = "Mallory";
  assert.throws(
    () => assertLocatorOnlyRefinement(original, changedValue),
    /locator fields/,
  );
});

test("Probe Planner sends one source-blind OpenAI-compatible request", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchFn: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return jsonResponse({
      choices: [{ message: { content: JSON.stringify(validPlan()) } }],
    });
  };
  const planner = new LlmProbePlanner(
    {
      baseUrl: "https://gateway.example/v1",
      apiKey: "secret-key",
      model: "provider/model",
      timeoutMs: 1_000,
    },
    fetchFn,
  );

  const result = await planner.plan(packet());

  assert.equal(result.cases.length, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://gateway.example/v1/chat/completions");
  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.get("authorization"), "Bearer secret-key");
  const body = JSON.stringify(JSON.parse(String(calls[0].init?.body)));
  assert.match(body, /Keep the profile after refresh/);
  assert.match(body, /happy_path/);
  assert.doesNotMatch(
    body,
    /candidate-app|source code|git diff|acceptedSha|SECRET-OTHER-REQ|\/workspace\/tests/,
  );
});

test("Probe Planner instructs literal locators and absence, persistence, and deep-link probes", async () => {
  const bodies: string[] = [];
  const fetchFn: typeof fetch = async (_input, init) => {
    bodies.push(String(init?.body));
    return jsonResponse({
      choices: [{ message: { content: JSON.stringify(validPlan()) } }],
    });
  };
  const planner = new LlmProbePlanner(config(), fetchFn);

  await planner.plan(packet());

  const body = bodies[0];
  assert.match(body, /exactUiStrings/);
  assert.match(body, /regular expression/i);
  assert.match(body, /deep link/i);
  assert.match(body, /exact: false/);
  assert.match(body, /count 0/);
  assert.match(body, /reload to verify/);
  assert.match(body, /newContext/);
  assert.match(body, /boundary cases/);
  assert.match(body, /empty, oversized, or invalid inputs/);
  assert.match(body, /never assert feedback the evidence does not state/i);
});

test("Probe Planner forwards declared seed data and omits it when empty", async () => {
  const bodies: string[] = [];
  const fetchFn: typeof fetch = async (_input, init) => {
    bodies.push(String(init?.body));
    return jsonResponse({
      choices: [{ message: { content: JSON.stringify(validPlan()) } }],
    });
  };
  const planner = new LlmProbePlanner(config(), fetchFn);

  const seedData: SeedDataCategory[] = [
    { category: "notes", items: ["Sprint goals", "Groceries"] },
  ];
  await planner.plan(packet(seedData));

  const seeded = JSON.parse(bodies[0]) as { messages: Array<{ content: string }> };
  assert.match(seeded.messages[0].content, /seedData is supplied/);
  assert.match(seeded.messages[0].content, /appear verbatim/);
  const seededPayload = JSON.parse(seeded.messages[1].content) as { seedData?: unknown };
  assert.deepEqual(seededPayload.seedData, seedData);

  await planner.plan(packet());
  const plain = JSON.parse(bodies[1]) as { messages: Array<{ content: string }> };
  const plainPayload = JSON.parse(plain.messages[1].content) as { seedData?: unknown };
  assert.equal("seedData" in plainPayload, false);
});

test("Probe Planner extracts JSON from fenced and annotated responses", async () => {
  const raw = JSON.stringify(validPlan());
  const contents = [
    `\`\`\`json\n${raw}\n\`\`\``,
    `\`\`\`\n${raw}\n\`\`\``,
    `Here is the probe plan:\n${raw}\nDone.`,
    `Notes {not: "the plan"} aside. ${raw}`,
  ];

  for (const content of contents) {
    const planner = new LlmProbePlanner(config(), async () =>
      jsonResponse({ choices: [{ message: { content } }] }),
    );
    const result = await planner.plan(packet());
    assert.equal(result.packetId, "packet-profile");
    assert.equal(result.cases.length, 2);
  }
});

test("Probe Planner reports stable transport, JSON, and schema categories", async () => {
  const cases: Array<{ response: Response; category: string }> = [
    { response: new Response("bad", { status: 503 }), category: "transport" },
    {
      response: jsonResponse({ choices: [{ message: { content: "not json" } }] }),
      category: "json",
    },
    {
      response: jsonResponse({
        choices: [{ message: { content: JSON.stringify({ packetId: "x", cases: [] }) } }],
      }),
      category: "schema",
    },
  ];

  for (const item of cases) {
    const planner = new LlmProbePlanner(config(), async () => item.response);
    await assert.rejects(
      planner.plan(packet()),
      (error: unknown) =>
        error instanceof ProbePlannerError && error.category === item.category,
    );
  }
});

test("Planner classifies gateway retryability from HTTP status, not response text", async () => {
  for (const status of [408, 429, 500, 503, 400, 401, 403, 404]) {
    const planner = new LlmProbePlanner(config(), async () => new Response("transient network timeout", { status }));
    await assert.rejects(planner.plan(packet()), (error: unknown) => {
      assert.ok(error instanceof ProbePlannerError);
      const retryable = [408, 429, 500, 503].includes(status);
      assert.equal(error.retryable, retryable);
      assert.equal(error.fatal, !retryable);
      assert.equal(error.diagnostics.httpStatus, status);
      return true;
    });
  }
});

test("Probe Planner preserves bounded, redacted validation diagnostics", async () => {
  const content = JSON.stringify({
    packetId: packet().id, cases: [], password: "private-value",
    note: `secret-key\u0001 Bearer private-bearer ${"x".repeat(2000)}`,
  });
  const planner = new LlmProbePlanner(config(), async () =>
    jsonResponse({ choices: [{ message: { content } }] }),
  );
  await assert.rejects(planner.plan(packet()), (error: unknown) => {
    assert.ok(error instanceof ProbePlannerError);
    assert.equal(error.diagnostics.category, "schema");
    assert.match(error.diagnostics.validationError ?? "", /unsupported ProbePlan field: password/);
    assert.match(error.diagnostics.contentPreview ?? "", /packet-profile/);
    assert.ok((error.diagnostics.contentPreview?.length ?? 0) <= 1500);
    assert.doesNotMatch(JSON.stringify(error.diagnostics), /private-value|secret-key|private-bearer/);
    return true;
  });
});

test("Probe Planner reports rejected refinement details and keeps the one-refinement limit", async () => {
  const changed = validPlan();
  changed.cases[0].steps[1].value = "different-input";
  let calls = 0;
  const planner = new LlmProbePlanner(config(), async () => {
    calls += 1;
    return jsonResponse({ choices: [{ message: { content: JSON.stringify(changed) } }] });
  });
  const original = parseProbePlan(validPlan(), packet());
  await assert.rejects(planner.refineLocators(original, "- textbox Profile"), (error: unknown) => {
    assert.ok(error instanceof ProbePlannerError);
    assert.equal(error.category, "refinement");
    assert.match(error.diagnostics.validationError ?? "", /only locator fields/);
    assert.match(error.diagnostics.contentPreview ?? "", /different-input/);
    return true;
  });
  await assert.rejects(planner.refineLocators(original, "- textbox Profile"), /already used/);
  assert.equal(calls, 1);
});

test("Probe Planner allows one sanitized locator refinement per packet", async () => {
  const bodies: string[] = [];
  const fetchFn: typeof fetch = async (_input, init) => {
    bodies.push(String(init?.body));
    const refined = validPlan();
    refined.cases[0].steps[1] = {
      op: "fill",
      locator: { by: "role", role: "textbox", name: "Profile name" },
      value: "Ada",
    };
    return jsonResponse({
      choices: [{ message: { content: JSON.stringify(refined) } }],
    });
  };
  const planner = new LlmProbePlanner(config(), fetchFn);
  const original = parseProbePlan(validPlan(), packet());

  await planner.refineLocators(
    original,
    `- textbox "Profile name"\npassword: super-secret\ntoken=abc123\n${"x".repeat(10_000)}`,
  );

  assert.equal(bodies.length, 1);
  assert.doesNotMatch(bodies[0], /super-secret|abc123/);
  const request = JSON.parse(bodies[0]) as { messages: Array<{ content: string }> };
  const refinement = JSON.parse(request.messages[1].content) as { accessibilitySnapshot: string };
  assert.ok(refinement.accessibilitySnapshot.length <= 4_000);
  await assert.rejects(
    planner.refineLocators(original, "second snapshot"),
    (error: unknown) =>
      error instanceof ProbePlannerError && error.category === "refinement",
  );
});

function validPlan(): {
  packetId: string;
  cases: Array<{
    id: string;
    requirementIds: string[];
    purpose: string;
    steps: Array<Record<string, unknown>>;
  }>;
} {
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
            locator: { by: "label", text: "Profile name", exact: true },
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

function packet(seedData: SeedDataCategory[] = []): WorkPacket {
  return {
    id: "packet-profile",
    requirementIds: ["REQ-PROFILE"],
    attempt: 1,
    requirements: [
      {
        id: "REQ-PROFILE",
        folderPath: ["ROOT", "PROFILE"],
        declarationIndex: 0,
        name: "Profile",
        text: "Keep the profile after refresh.",
        dependencyIds: [],
        scenarios: ["Save the profile"],
        references: ["reference/profile.png"],
        exactUiStrings: ["Profile name", "Save"],
        product: {
          kind: "generic_web",
          rootId: "ROOT",
          rootName: "Demo Product",
          description: "Root description.",
          seedData,
        },
        ancestors: [
          { id: "PROFILE", name: "Profile", description: "Profile area" },
        ],
      },
    ],
  };
}

function config() {
  return {
    baseUrl: "https://gateway.example/v1",
    apiKey: "secret-key",
    model: "provider/model",
    timeoutMs: 1_000,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

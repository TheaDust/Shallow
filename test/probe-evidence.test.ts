import assert from "node:assert/strict";
import { test } from "node:test";
import { auditPacket } from "../src/judge/audit.js";
import { assertCoverageAccountedFor, probeCoverageGaps } from "../src/judge/probe-coverage.js";
import { parseProbePlan, type ProbePlan } from "../src/judge/probe-schema.js";
import { parsePlanReview } from "../src/judge/semantic-review.js";
import { rootSearchNavigationPlan } from "../src/judge/navigation-recovery.js";
import { RunStateStore } from "../src/run-state.js";
import { LlmProbePlanner, ProbePlannerError } from "../src/judge/llm-probe-planner.js";
import type { WorkPacket } from "../src/types.js";
import { withModulePipeline } from "./helpers/module-pipeline.js";

function packet(): WorkPacket {
  return { id: "p", attempt: 1, requirementIds: ["r"], requirements: [{ id: "r", name: "Edit", text: "Save title and description.",
    folderPath: ["ROOT", "AREA"], declarationIndex: 0, dependencyIds: [], scenarios: [], references: [], exactUiStrings: [], seedDeclarations: [], ancestors: [],
    product: { rootId: "ROOT", rootName: "Product", kind: "generic_web", description: "", seedData: [] },
    scenarioContracts: [{ id: "edit", name: "Save", steps: [{ keyword: "GIVEN", content: "A record exists." },
      { keyword: "WHEN", content: "Save changes." }, { keyword: "THEN", content: "The title is saved." },
      { keyword: "AND", content: "The description is saved." }] }] }] };
}
function plan(): ProbePlan {
  return { packetId: "p", uncoveredOutcomes: [], cases: [{ id: "edit-case", requirementIds: ["r"], purpose: "happy_path",
    expectationBasis: ["Save title and description."], setupStepCount: 2,
    steps: [{ op: "goto", path: "/" }, { op: "expectVisible", locator: { by: "role", role: "main" } },
      { op: "click", locator: { by: "role", role: "button", name: "Save", exact: true } },
      { op: "expectText", locator: { by: "role", role: "heading" }, text: "Saved title" },
      { op: "expectText", locator: { by: "role", role: "status" }, text: "Saved description" }],
    outcomeChecks: [{ scenarioId: "edit", stepIndex: 2, assertionIndexes: [1] },
      { scenarioId: "edit", stepIndex: 3, assertionIndexes: [2] }] }] };
}

test("Scenario coverage requires every THEN and following AND and points to business assertions", () => {
  const input = packet();
  const complete = parseProbePlan(plan(), input);
  assertCoverageAccountedFor(complete, input.requirements);
  assert.deepEqual(probeCoverageGaps(complete, input.requirements), []);
  const missing = structuredClone(complete);
  missing.cases[0].outcomeChecks!.pop();
  assert.throws(() => assertCoverageAccountedFor(missing, input.requirements), /unaccounted/);
  missing.uncoveredOutcomes = [{ scenarioId: "edit", stepIndex: 3, reason: "DSL cannot express this result" }];
  assertCoverageAccountedFor(missing, input.requirements);
  assert.equal(probeCoverageGaps(missing, input.requirements).length, 1);
  for (const index of [0, 3]) {
    const invalid = plan();
    invalid.cases[0].outcomeChecks![0].assertionIndexes = [index];
    assert.throws(() => parseProbePlan(invalid, input), /result assertions/);
  }
  const phantom = plan();
  phantom.cases[0].outcomeChecks![0].scenarioId = "unrelated";
  assert.throws(() => parseProbePlan(phantom, input), /undeclared scenario outcome/);
});

test("Passing a weak plan with an omitted THEN cannot grant verified; a sampled guard checks only its paths", async () => {
  await withModulePipeline(async f => {
    const incomplete = plan();
    incomplete.cases[0].outcomeChecks!.pop();
    const state = new RunStateStore({ statusByRequirementId: { r: "todo" }, acceptedSha: "baseline", startedAtMs: 0, totalBudgetMs: 60_000 });
    const result = await auditPacket(packet(), incomplete, f.options, f.deps, state, () => 60_000, { refineLocators: false });
    assert.equal(result.status, "inconclusive");
    assert.equal(result.failureKind, "coverage");
    assert.equal(result.coverageGaps?.[0].stepIndex, 3);
    const guard = await auditPacket(packet(), incomplete, f.options, f.deps, state, () => 60_000, { refineLocators: false, checkCoverage: false });
    assert.equal(guard.status, "verified");
  });
});

test("LLM planning rejects an unexplained coverage omission and accepts an explicitly partial plan", async () => {
  const incomplete = plan();
  incomplete.cases[0].outcomeChecks!.pop();
  const planner = new LlmProbePlanner({ baseUrl: "https://gateway.invalid/v1", apiKey: "test", model: "model", timeoutMs: 1000 },
    async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(incomplete) } }] }), { headers: { "Content-Type": "application/json" } }));
  await assert.rejects(planner.plan(packet()), (error: unknown) => error instanceof ProbePlannerError && error.category === "schema" &&
    error.diagnostics.validationError?.includes("unaccounted") === true);
  incomplete.uncoveredOutcomes = [{ scenarioId: "edit", stepIndex: 3, reason: "Unsupported result" }];
  const partial = await planner.plan(packet());
  assert.equal(probeCoverageGaps(partial, packet().requirements).length, 1);
  incomplete.navigationRecovered = true;
  await assert.rejects(planner.plan(packet()), (error: unknown) => error instanceof ProbePlannerError &&
    error.diagnostics.validationError?.includes("controller navigation recovery evidence") === true);
});

test("Case capacity follows independent source scenarios while remaining bounded", () => {
  const input = packet();
  const expanded = plan();
  expanded.cases = Array.from({ length: 7 }, (_, index) => ({ ...structuredClone(expanded.cases[0]), id: `case-${index}` }));
  assert.throws(() => parseProbePlan(expanded, input), /at most 6 cases/);
  const original = input.requirements[0].scenarioContracts![0];
  input.requirements[0].scenarioContracts = Array.from({ length: 7 }, (_, index) => ({ ...original, id: `scenario-${index}` }));
  expanded.cases.forEach((item, index) => item.outcomeChecks!.forEach(check => { check.scenarioId = `scenario-${index}`; }));
  assert.equal(parseProbePlan(expanded, input).cases.length, 7);
  assertCoverageAccountedFor(expanded, input.requirements);
});

test("Preparation corrections keep outcome positions relative to the frozen business suffix", () => {
  const original = plan();
  const reviewed = parsePlanReview({ verdict: "corrected", rationale: "Establish the declared record",
    corrections: [{ caseId: "edit-case", conflict: "The record was not prepared", basis: ["A record exists."], setupSteps: [
      { op: "goto", path: "/" }, { op: "reload" }, { op: "expectVisible", locator: { by: "role", role: "main" } },
    ] }] }, packet(), original, { preparationOnlyCaseIds: ["edit-case"], caseCorrectionIds: [] });
  assert.equal(reviewed.status, "corrected");
  if (reviewed.status !== "corrected") return;
  assert.deepEqual(reviewed.plan.cases[0].outcomeChecks, original.cases[0].outcomeChecks);
  assert.equal(reviewed.plan.cases[0].setupStepCount, 3);
  assertCoverageAccountedFor(reviewed.plan, packet().requirements);
});

test("A semantic rewrite cannot remove a previously covered scenario outcome", () => {
  const original = plan();
  const changed = structuredClone(original.cases[0]);
  changed.outcomeChecks!.pop();
  const assertion = changed.steps.pop();
  assert.throws(() => parsePlanReview({ verdict: "corrected", rationale: "Correct the result",
    corrections: [{ caseId: "edit-case", conflict: "Expected title", basis: ["The title is saved."], case: { ...changed, assertion } }] },
  packet(), original), /preserve scenario outcome coverage/);
});

test("Explicit owner/name heading templates reject shortened, slugged and weak alternatives", () => {
  const input = packet();
  input.requirements[0].scenarioContracts = [];
  input.requirements[0].text = 'Open a heading displaying “organization name/repository name”.';
  input.requirements[0].seedDeclarations = ['Seed values: organization `Acme Demo`, repository `acme-docs`.'];
  const make = (text: string, exact = true): ProbePlan => ({ packetId: "p", cases: [{ id: "title", requirementIds: ["r"], purpose: "happy_path",
    expectationBasis: [input.requirements[0].text], steps: [{ op: "goto", path: "/" },
      { op: "expectText", locator: { by: "role", role: "heading" }, text, exact }] }] });
  assert.doesNotThrow(() => parseProbePlan(make("Acme Demo/acme-docs"), input));
  for (const title of ["acme-docs", "acme-demo/acme-docs", "Acme Demo/other"]) {
    assert.throws(() => parseProbePlan(make(title), input), /complete.*heading/);
  }
  assert.throws(() => parseProbePlan(make("Acme Demo/acme-docs", false), input), /exact matching/);
  const alternatives = make("Acme Demo/acme-docs");
  const last = alternatives.cases[0].steps[1];
  if (last.op === "expectText") last.anyOf = ["Acme Demo/acme-docs", "acme-docs"];
  assert.throws(() => parseProbePlan(alternatives, input), /complete.*heading/);
  const negative = make("Permission denied");
  negative.cases[0].purpose = "permission";
  assert.doesNotThrow(() => parseProbePlan(negative, input));
});

test("Preparation has its own bounded allowance while tested business stays within 30 steps", () => {
  const extended = plan();
  extended.cases[0].steps.splice(1, 0, ...Array.from({ length: 10 }, () => ({ op: "reload" as const })));
  extended.cases[0].setupStepCount = 12;
  extended.cases[0].steps.splice(13, 0, ...Array.from({ length: 26 }, () => ({ op: "reload" as const })));
  extended.cases[0].outcomeChecks![0].assertionIndexes = [27];
  extended.cases[0].outcomeChecks![1].assertionIndexes = [28];
  assert.equal(parseProbePlan(extended, packet()).cases[0].steps.length, 41);
  const tooMuchBusiness = structuredClone(extended);
  tooMuchBusiness.cases[0].steps.splice(13, 0, { op: "reload" }, { op: "reload" });
  assert.throws(() => parseProbePlan(tooMuchBusiness, packet()), /at most 30 steps after preparation/);
});

test("Search recovery preserves outcome mappings in setup and leaves a tested entry assertion intact", () => {
  const input = packet();
  input.requirements[0].text = 'Open workspace `Shared` from search results.';
  input.requirements[0].seedDeclarations = ['Seed data: workspace `Shared`.'];
  input.requirements[0].exactUiStrings = ["Shared"];
  const original = plan();
  original.cases[0].steps[1] = { op: "expectVisible", locator: { by: "role", role: "link", name: "Shared", exact: true } };
  original.cases[0].expectationBasis = [input.requirements[0].text];
  const failure = { caseId: "edit-case", stepIndex: 1, category: "precondition" as const, message: "missing link",
    locatorSnapshot: '- searchbox "Search"' };
  const recovered = rootSearchNavigationPlan(input, original, { packetId: "p", verdict: "inconclusive", passedCases: [], failures: [failure] });
  assert.equal(recovered?.navigationRecovered, true);
  assert.equal(recovered?.cases[0].setupStepCount, 4);
  assert.deepEqual(recovered?.cases[0].outcomeChecks, original.cases[0].outcomeChecks);
  const businessEntry = structuredClone(original);
  businessEntry.cases[0].steps[3] = businessEntry.cases[0].steps[1];
  assert.equal(rootSearchNavigationPlan(input, businessEntry, { packetId: "p", verdict: "inconclusive", passedCases: [],
    failures: [{ ...failure, stepIndex: 3, category: "locator" }] }), undefined);
});

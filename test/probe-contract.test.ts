import assert from "node:assert/strict";
import { test } from "node:test";
import { assertLocatorOnlyRefinement, groundedLocatorAnchors, parseProbePlan, PROBE_PLAN_BODY, toWireProbePlan, type ProbeLocator, type ProbePlan } from "../src/judge/probe-schema.js";
import type { WorkPacket } from "../src/types.js";

function packet(text = 'Open "Items" and click "Publish".'): WorkPacket {
  return { id: "packet-a", requirementIds: ["A"], attempt: 1, requirements: [{
    id: "A", name: "Publish", text, declarationIndex: 0, folderPath: ["ROOT"], ancestors: [],
    dependencyIds: [], scenarios: [], references: [], exactUiStrings: ["Items", "Publish"], seedDeclarations: [],
    product: { kind: "generic_web", rootId: "ROOT", rootName: "Product", description: "", seedData: [] },
  }] };
}

function plan(path = "/"): ProbePlan {
  return { packetId: "packet-a", cases: [{ id: "publish", requirementIds: ["A"], purpose: "happy_path",
    expectationBasis: ["Open"], steps: [
    { op: "goto", path },
    { op: "click", locator: { by: "role", role: "button", name: "Publish", exact: true } },
    { op: "expectVisible", locator: { by: "role", role: "status" } },
  ] }] };
}

test("Deep links require exact public path evidence, including hash and query", () => {
  assert.doesNotThrow(() => parseProbePlan(plan(), packet()));
  for (const path of ["/items", "/login", "/items/42", "/#/items"]) {
    assert.throws(() => parseProbePlan(plan(path), packet()), /undeclared goto path.*start at \//);
  }
  for (const path of ["/items", "/#/items?tab=recent", "/item/42"]) {
    assert.doesNotThrow(() => parseProbePlan(plan(path), packet(`Open \`${path}\`.`)));
    assert.doesNotThrow(() => parseProbePlan(plan(path), packet(`Open https://example.invalid${path}.`)));
  }
  assert.throws(() => parseProbePlan(plan("/items"), packet("Open /items/42.")), /undeclared/);
  assert.throws(() => parseProbePlan(plan("/items"), packet("See ![view](/items).")), /undeclared/);
  const input = packet();
  input.prerequisites = [{ ...input.requirements[0], id: "P", text: "Open `/workspace`." }];
  assert.doesNotThrow(() => parseProbePlan(plan("/workspace"), input));
  const rootPath = packet();
  rootPath.requirements[0].product.description = "Open /workspace from the home page.";
  assert.doesNotThrow(() => parseProbePlan(plan("/workspace"), rootPath));
  rootPath.requirements[0].product.description = "See ![preview](/workspace).";
  assert.throws(() => parseProbePlan(plan("/workspace"), rootPath), /undeclared/);
});

test("Root product contract can ground a probe expectation", () => {
  assert.match(PROBE_PLAN_BODY.properties.cases.items.properties.expectationBasis.description, /ROOT product description/);
  const input = packet();
  input.requirements[0].product.description = "The workspace shows saved items.";
  const grounded = plan();
  grounded.cases[0].expectationBasis = ["The workspace shows saved items."];
  assert.doesNotThrow(() => parseProbePlan(grounded, input));
});

test("Refinement can change rendering but cannot replace a declared action with an error or unrelated control", () => {
  const original = plan();
  const target = [{ caseId: "publish", stepIndex: 1 }];
  const refined = plan();
  for (const locator of [
    { by: "text", text: "Not Found" },
    { by: "role", role: "button", name: "Login" },
    { by: "role", role: "button", name: "Unpublish" },
    { by: "role", role: "main" },
    { by: "text", text: "Not Found", scope: { by: "text", text: "Publish" } },
    { by: "role", role: "link", name: "Publish", fallbacks: [{ by: "text", text: "Not Found" }] },
  ] satisfies ProbeLocator[]) {
    refined.cases[0].steps[1] = { op: "click", locator };
    assert.throws(() => assertLocatorOnlyRefinement(original, refined, target, packet()), /requirement-grounded target/);
  }
  refined.cases[0].steps[1] = { op: "click", locator: { by: "role", role: "link", name: "Publish item", exact: true } };
  assert.doesNotThrow(() => assertLocatorOnlyRefinement(original, refined, target, packet()));
  // Guessed names can still be corrected when the requirement did not specify them.
  const unnamed = packet();
  unnamed.requirements[0].exactUiStrings = [];
  assert.doesNotThrow(() => assertLocatorOnlyRefinement(original, refined, target, unnamed));
});

test("Refinement cannot downgrade a named control to plain text (grader-style operability)", () => {
  // Modeled on the Keep-style grading contract: card actions must stay real
  // controls (card.getByRole('button', { name: /^Archive$/i })), a visible
  // "Archive" text node is not an operable Archive action.
  const keepPacket = packet('Archive a note from the note actions area and show an Undo notification.');
  keepPacket.requirements[0].exactUiStrings = ["Archive", "Undo"];
  const original: ProbePlan = { packetId: "packet-a", cases: [{ id: "archive-note", requirementIds: ["A"], purpose: "happy_path",
    expectationBasis: ["show an Undo notification"], steps: [
    { op: "goto", path: "/" },
    { op: "click", locator: { by: "role", role: "button", name: "Archive", exact: true } },
    { op: "expectVisible", locator: { by: "role", role: "button", name: "Undo", exact: true } },
  ] }] };
  const failedClick = [{ caseId: "archive-note", stepIndex: 1 }];

  const toText = structuredClone(original);
  toText.cases[0].steps[1] = { op: "click", locator: { by: "text", text: "Archive", exact: true } };
  assert.throws(() => assertLocatorOnlyRefinement(original, toText, failedClick, keepPacket), /downgrade.*plain text/);

  const toTextFallback = structuredClone(original);
  toTextFallback.cases[0].steps[1] = { op: "click", locator: { by: "text", text: "Archive", exact: true,
    fallbacks: [{ by: "text", text: "Archive note" }] } };
  assert.throws(() => assertLocatorOnlyRefinement(original, toTextFallback, failedClick, keepPacket), /downgrade.*plain text/);

  // Equivalent control renderings remain allowed: button -> link/menuitem with a named role candidate.
  const toLink = structuredClone(original);
  toLink.cases[0].steps[1] = { op: "click", locator: { by: "role", role: "link", name: "Archive", exact: true,
    fallbacks: [{ by: "role", role: "menuitem", name: "Archive", exact: true }] } };
  assert.doesNotThrow(() => assertLocatorOnlyRefinement(original, toLink, failedClick, keepPacket));

  // A field located by label may be refined to the same field's role form, not to bare text.
  const fieldPlan: ProbePlan = { packetId: "packet-a", cases: [{ id: "edit-note", requirementIds: ["A"], purpose: "happy_path",
    expectationBasis: ["show an Undo notification"], steps: [
    { op: "goto", path: "/" },
    { op: "fill", locator: { by: "label", text: "Note content", exact: true }, value: "Updated content" },
    { op: "expectVisible", locator: { by: "role", role: "button", name: "Undo", exact: true } },
  ] }] };
  const fieldToText = structuredClone(fieldPlan);
  fieldToText.cases[0].steps[1] = { op: "fill", locator: { by: "text", text: "Note content" }, value: "Updated content" };
  assert.throws(() => assertLocatorOnlyRefinement(fieldPlan, fieldToText, [{ caseId: "edit-note", stepIndex: 1 }]), /downgrade.*plain text/);
  const fieldToRole = structuredClone(fieldPlan);
  fieldToRole.cases[0].steps[1] = { op: "fill", locator: { by: "role", role: "textbox", name: "Note content", exact: true }, value: "Updated content" };
  assert.doesNotThrow(() => assertLocatorOnlyRefinement(fieldPlan, fieldToRole, [{ caseId: "edit-note", stepIndex: 1 }]));

  // Display-only targets (headings, status areas) assert visibility, so text is a legitimate refinement.
  const displayPlan = structuredClone(original);
  displayPlan.cases[0].steps[1] = { op: "expectVisible", locator: { by: "role", role: "heading", name: "Archived notes" } };
  const displayToText = structuredClone(displayPlan);
  displayToText.cases[0].steps[1] = { op: "expectVisible", locator: { by: "text", text: "Archived notes" } };
  assert.doesNotThrow(() => assertLocatorOnlyRefinement(displayPlan, displayToText, [{ caseId: "archive-note", stepIndex: 1 }], keepPacket));
});

test("Refinement keeps exact matching for requirement-declared names", () => {
  const keepPacket = packet('Archive a note from the note actions area and show an Undo notification.');
  keepPacket.requirements[0].exactUiStrings = ["Archive", "Undo"];
  const original: ProbePlan = { packetId: "packet-a", cases: [{ id: "archive-note", requirementIds: ["A"], purpose: "happy_path",
    expectationBasis: ["show an Undo notification"], steps: [
    { op: "goto", path: "/" },
    { op: "click", locator: { by: "role", role: "button", name: "Archive", exact: true } },
    { op: "expectVisible", locator: { by: "role", role: "button", name: "Undo", exact: true } },
  ] }] };
  const failedClick = [{ caseId: "archive-note", stepIndex: 1 }];

  // /^Archive$/i must not become a substring match: "Archive note" would pass a probe a grader fails.
  const droppedExact = structuredClone(original);
  droppedExact.cases[0].steps[1] = { op: "click", locator: { by: "role", role: "button", name: "Archive" } };
  assert.throws(() => assertLocatorOnlyRefinement(original, droppedExact, failedClick, keepPacket), /exact/);

  // Guessed (undeclared) names may still relax exactness, and exact candidates keep the match.
  const guessPacket = packet();
  guessPacket.requirements[0].exactUiStrings = [];
  assert.doesNotThrow(() => assertLocatorOnlyRefinement(original, droppedExact, failedClick, guessPacket));
  const keptExact = structuredClone(original);
  keptExact.cases[0].steps[1] = { op: "click", locator: { by: "role", role: "link", name: "Archive", exact: true } };
  assert.doesNotThrow(() => assertLocatorOnlyRefinement(original, keptExact, failedClick, keepPacket));
});

test("Grounded anchors keep declared names in original casing and ignore guesses", () => {
  assert.deepEqual(groundedLocatorAnchors(plan(), packet()), ["Publish"]);
  const unnamed = packet();
  unnamed.requirements[0].exactUiStrings = [];
  assert.deepEqual(groundedLocatorAnchors(plan(), unnamed), []);
});

test("State assertions round-trip through the wire schema and cannot be changed by refinement", () => {
  const original = plan();
  original.cases[0].steps.push(
    { op: "expectHidden", locator: { by: "role", role: "dialog" } },
    { op: "expectAttribute", locator: { by: "role", role: "button", name: "Toggle" }, attribute: "aria-expanded", value: "false" },
  );
  assert.deepEqual(parseProbePlan(toWireProbePlan(original), packet()), original);
  const changed = structuredClone(original);
  const last = changed.cases[0].steps.at(-1);
  if (last?.op !== "expectAttribute") assert.fail("expected state assertion");
  last.value = "true";
  assert.throws(() => assertLocatorOnlyRefinement(original, changed), /only locator fields/);
  for (const attribute of ["onclick", "innerHTML", "class", "data-result"]) {
    const invalid = toWireProbePlan({ ...original, cases: [{ ...original.cases[0], steps: [
      ...original.cases[0].steps.slice(0, -1),
      { ...last, attribute } as typeof last,
    ] }] });
    assert.throws(() => parseProbePlan(invalid), /allowed ARIA state/);
  }
});

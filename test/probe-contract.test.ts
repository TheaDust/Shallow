import assert from "node:assert/strict";
import { test } from "node:test";
import { assertLocatorOnlyRefinement, groundedLocatorAnchors, parseProbePlan, toWireProbePlan, type ProbeLocator, type ProbePlan } from "../src/judge/probe-schema.js";
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

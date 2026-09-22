import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePlanReview } from "../src/judge/semantic-review.js";
import { parseProbePlan, type ProbePlan } from "../src/judge/probe-schema.js";
import type { WorkPacket } from "../src/types.js";

test("A sound review carries no plan and requires a rationale", () => {
  const review = parsePlanReview({ verdict: "sound", rationale: "线索来自 active 列表的原文" }, packet(), original());
  assert.deepEqual(review, { status: "sound", rationale: "线索来自 active 列表的原文" });
  assert.throws(() => parsePlanReview({ verdict: "sound", rationale: "x", plan: {} }, packet(), original()), /must not carry/);
  assert.throws(() => parsePlanReview({ verdict: "sound" }, packet(), original()), /rationale/);
});

test("A corrected review must change the plan, cite conflicts, and ground its basis quotes", () => {
  const review = parsePlanReview({
    verdict: "corrected",
    rationale: "计划误读 active 种子",
    corrections: [{ caseId: "case-A", conflict: "计划去归档区恢复，但需求写明 active", basis: ["Display the main workspace."] }],
    plan: corrected(),
  }, packet(), original());
  assert.equal(review.status, "corrected");
  if (review.status !== "corrected") return;
  assert.equal(review.corrections.length, 1);
  assert.equal(review.plan.cases[0].steps.length, 2);
});

test("Corrected reviews reject unchanged plans, phantom cases, weak citations, and uncovered requirements", () => {
  const base = {
    verdict: "corrected",
    rationale: "原因",
    corrections: [{ caseId: "case-A", conflict: "冲突", basis: ["Display the main workspace."] }],
  };
  assert.throws(() => parsePlanReview({ ...base, plan: toWire(original()) }, packet(), original()), /must differ/);
  assert.throws(() => parsePlanReview({ ...base, corrections: [{ ...base.corrections[0], caseId: "ghost" }], plan: corrected() },
    packet(), original()), /reviewed and corrected plans/);
  assert.throws(() => parsePlanReview({ ...base, corrections: [{ ...base.corrections[0], basis: ["invented expectation"] }], plan: corrected() },
    packet(), original()), /verbatim/);
  const uncovered = corrected();
  uncovered.cases[0] = { ...uncovered.cases[0], requirementIds: ["OTHER"] };
  assert.throws(() => parsePlanReview({ ...base, plan: uncovered }, packet(), original()), /outside packet/);
});

function packet(): WorkPacket {
  return { id: "packet-a", requirementIds: ["A"], attempt: 1, requirements: [{
    id: "A", name: "Workspace", text: "Display the main workspace.", declarationIndex: 0, folderPath: ["ROOT"],
    ancestors: [], dependencyIds: [], scenarios: ["Open the workspace"], references: [], exactUiStrings: [], seedDeclarations: [],
    product: { kind: "generic_web", rootId: "ROOT", rootName: "Product", description: "", seedData: [] },
  }] };
}
function original(): ProbePlan {
  return parseProbePlan({ packetId: "packet-a", cases: [{ id: "case-A", requirementIds: ["A"], purpose: "happy_path",
    expectationBasis: ["Display the main workspace."], steps: [{ op: "goto", path: "/" },
    { op: "expectVisible", locator: { by: "role", role: "tab", name: "Home" } }] }] }, packet());
}
function corrected(): { packetId: string; cases: Array<{ id: string; requirementIds: string[];
  purpose: string; expectationBasis?: string[]; steps: Array<Record<string, unknown>> }> } {
  return { packetId: "packet-a", cases: [{ id: "case-A", requirementIds: ["A"], purpose: "happy_path",
    expectationBasis: ["Display the main workspace."], steps: [{ op: "goto", path: "/" },
    { op: "expectVisible", locator: { by: "role", role: "main" } }] }] };
}
function toWire(plan: ProbePlan): unknown {
  return { packetId: plan.packetId, cases: plan.cases.map(item => ({ ...item,
    steps: item.steps.slice(0, -1), assertion: item.steps.at(-1) })) };
}

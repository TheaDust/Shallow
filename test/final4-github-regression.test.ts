import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { loadRequirementCatalog } from "../src/catalog.js";
import { auditPackets } from "../src/scheduler.js";
import { globalControlCrossRoutePlan, overlayLifecyclePlan } from "../src/judge/compatibility-probes.js";
import { declaredLocatorRoles, parseProbePlan, type ProbePlan } from "../src/judge/probe-schema.js";

test("final-4 GitHub retains its original plans while deriving the actual shared-header checkpoints", async () => {
  const root = "official-run/final-4/github";
  const catalog = await loadRequirementCatalog(join(root, "requirements/requirements.yaml"), { inheritedApplication: true });
  const packets = auditPackets(catalog);
  // Historical mirrors identify inherited work; they are never current Judge
  // plans. This corpus checks only the requirements of the official final run.
  const currentIds = new Set(["REQ-1-1-1", "REQ-1-1-2", "REQ-1-4", "REQ-2-1-2", "REQ-2-4",
    "REQ-3-1", "REQ-3-5", "REQ-4-3-1", "REQ-4-5", "REQ-5-5"]);
  const stored = await Promise.all((await readdir(join(root, "shallow-progress/plans"))).map(async name =>
    JSON.parse(await readFile(join(root, "shallow-progress/plans", name), "utf8")) as ProbePlan));
  const sources = stored.flatMap(original => {
    const packet = packets.find(candidate => candidate.id === original.packetId);
    if (!packet || !packet.requirementIds.some(id => currentIds.has(id))) return [];
    const plan = parseProbePlan(original, packet);
    assert.deepEqual(plan.cases.map(probeCase => probeCase.steps), original.cases.map(probeCase => probeCase.steps));
    return [{ packet, plan }];
  });
  const sessions = sources.find(source => source.packet.requirementIds.includes("REQ-1-4"))!;
  const closed = overlayLifecyclePlan(sessions.packet, sessions.plan);
  assert.ok(closed, "the inherited closed Sign out dialog must be checked without opening it");
  assert.equal(closed.cases[0].steps.at(-1)?.op, "expectClosedOverlaysEmpty");
  const releases = sources.find(source => source.packet.requirementIds.includes("REQ-4-5"))!;
  const crossRoute = globalControlCrossRoutePlan(releases.packet, releases.plan, sources);
  assert.ok(crossRoute);
  assert.equal(crossRoute.cases[0].steps[crossRoute.cases[0].setupStepCount! - 1].op, "expectAwayFromHome");
  assert.ok(crossRoute.cases[0].steps.slice(0, crossRoute.cases[0].setupStepCount).some(step =>
    step.op === "expectVisible" && step.locator.by === "role" && step.locator.role === "heading"));
  const archive = packets.find(packet => packet.requirementIds.includes("REQ-3-5"))!;
  for (const name of ["Archive repository", "Restore repository"]) {
    assert.deepEqual(declaredLocatorRoles({ by: "role", role: "button", name, exact: true }, archive, "click"), ["button"]);
    assert.deepEqual(declaredLocatorRoles({ by: "role", role: "dialog", name, exact: true }, archive, "expectVisible"), ["dialog"]);
  }
});

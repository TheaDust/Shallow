import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { loadRequirementCatalog } from "../src/catalog.js";
import { compatibilityApplicability } from "../src/judge/compatibility-contracts.js";
import { overlayLifecyclePlan } from "../src/judge/compatibility-probes.js";
import { assertCoverageAccountedFor, scenarioOutcomes } from "../src/judge/probe-coverage.js";
import { parseProbePlan, type ProbePlan } from "../src/judge/probe-schema.js";
import { auditPackets } from "../src/scheduler.js";

const REQUIREMENTS = "official-run/final-4/sheet/requirements/requirements.yaml";
const PLANS = "official-run/final-4/sheet/shallow-progress/plans";

test("final-4 spreadsheet corpus keeps stable outcomes and rejects unrelated compatibility triggers", async () => {
  const catalog = await loadRequirementCatalog(REQUIREMENTS, { inheritedApplication: true });
  const packets = auditPackets(catalog);
  assert.equal(packets.length, 10);
  // This is a golden-corpus assertion only. Production code does not know this
  // number; facets must remain children of these stable outcome identities.
  assert.equal(scenarioOutcomes(catalog.requirements).length, 82);
  for (const packet of packets) {
    assert.deepEqual(compatibilityApplicability(packet), {
      url: false,
      authPublicEntry: false,
      globalControl: false,
      entityDetailIdentity: false,
      uniquePublishConflict: false,
    });
  }
});

test("all current final-4 spreadsheet packet plans reparse without changing cases, steps, or requirement IDs", async () => {
  const catalog = await loadRequirementCatalog(REQUIREMENTS, { inheritedApplication: true });
  const packets = auditPackets(catalog);
  const packetById = new Map(packets.map(packet => [packet.id, packet]));
  const plans = await Promise.all((await readdir(PLANS)).map(async file =>
    JSON.parse(await readFile(join(PLANS, file), "utf8")) as ProbePlan));
  const current = plans.filter(plan => packetById.has(plan.packetId));
  assert.equal(current.length, packets.length);
  let lifecyclePlans = 0;
  for (const original of current) {
    const before = original.cases.map(probeCase => ({
      id: probeCase.id,
      requirementIds: probeCase.requirementIds,
      steps: probeCase.steps.length,
      setupStepCount: probeCase.setupStepCount ?? 0,
      outcomeChecks: probeCase.outcomeChecks,
    }));
    const parsed = parseProbePlan(original, packetById.get(original.packetId));
    assert.doesNotThrow(() => assertCoverageAccountedFor(parsed, packetById.get(original.packetId)!.requirements));
    assert.deepEqual(parsed.cases.map(probeCase => ({
      id: probeCase.id,
      requirementIds: probeCase.requirementIds,
      steps: probeCase.steps.length,
      setupStepCount: probeCase.setupStepCount ?? 0,
      outcomeChecks: probeCase.outcomeChecks,
    })), before);
    const lifecycle = overlayLifecyclePlan(packetById.get(original.packetId)!, parsed);
    if (lifecycle) {
      lifecyclePlans += 1;
      assert.ok(lifecycle.cases.every(probeCase =>
        probeCase.steps.some(step => step.op === "expectClosedOverlaysEmpty")));
    }
  }
  assert.ok(lifecyclePlans > 0, "the inherited spreadsheet corpus retains at least one grounded overlay lifecycle sample");
});

test("final-4 spreadsheet shared overlays remove closed dialog and menu content", async () => {
  const dialog = await readFile("official-run/final-4/sheet/frontend/src/ui/Dialog.tsx", "utf8");
  const menu = await readFile("official-run/final-4/sheet/frontend/src/ui/Menu.tsx", "utf8");
  assert.match(dialog, /\{open\s*\?\s*\(/);
  assert.match(menu, /\{open\s*\?\s*\(/);
});

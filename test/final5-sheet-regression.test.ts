import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { loadRequirementCatalog } from "../src/catalog.js";
import { auditPackets } from "../src/scheduler.js";
import { compatibilityApplicability, resultCompatibilityPlan } from "../src/judge/compatibility-contracts.js";
import { assertCoverageAccountedFor, outcomeKey, scenarioOutcomes } from "../src/judge/probe-coverage.js";
import { parseProbePlan, type ProbePlan } from "../src/judge/probe-schema.js";

test("final-5 spreadsheet preserves its outcomes and all nine available current plans", async () => {
  const root = "official-run/final-5/sheet";
  const catalog = await loadRequirementCatalog(join(root, "requirements/requirements.yaml"), { inheritedApplication: true });
  const previous = await loadRequirementCatalog("official-run/final-4/sheet/requirements/requirements.yaml", { inheritedApplication: true });
  assert.deepEqual(scenarioOutcomes(catalog.requirements).map(outcomeKey), scenarioOutcomes(previous.requirements).map(outcomeKey));
  const packets = auditPackets(catalog);
  const current = new Map(packets.map(packet => [packet.id, packet]));
  let checked = 0;
  for (const name of await readdir(join(root, "shallow-progress/plans"))) {
    const original = JSON.parse(await readFile(join(root, "shallow-progress/plans", name), "utf8")) as ProbePlan;
    const packet = current.get(original.packetId);
    if (!packet) continue;
    const parsed = parseProbePlan(original, packet);
    assertCoverageAccountedFor(parsed, packet.requirements);
    assert.deepEqual(parsed.cases.map(item => item.steps), original.cases.map(item => item.steps));
    assert.equal(resultCompatibilityPlan(packet, parsed), undefined, `${packet.id}: no unrelated entity convention`);
    assert.deepEqual(compatibilityApplicability(packet), { url: false, authPublicEntry: false, globalControl: false,
      entityDetailIdentity: false, uniquePublishConflict: false });
    checked++;
  }
  assert.equal(checked, 9, "missing current named-range planning is not fabricated into a passing plan");
});

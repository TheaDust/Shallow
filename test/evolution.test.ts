import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { loadRequirementCatalog } from "../src/catalog.js";
import { evolutionImplementationCatalog, readHistoricalPlanIds, selectEvolutionScope } from "../src/evolution.js";
import { featureGroupPackets, featureGroupingFromIds } from "../src/scheduler.js";
import { withModulePipeline } from "./helpers/module-pipeline.js";
import { withTempDir } from "./helpers/temp-dir.js";

const modified = "Original Feature Description\n\nDisplay the old workspace.\n\nModified Feature Description\n\nDisplay the updated workspace.";

test("Historical plan identity comes from case IDs, ignores broken files and remains frozen", async () => {
  await withTempDir("shallow-historical-ids-", async directory => {
    await writeFile(join(directory, "unrelated-file-name.json"), JSON.stringify({ packetId: "old-packet", coverageReview: "verified",
      cases: [{ requirementIds: ["A.1", "A_1"] }, { requirementIds: ["A.1"] }] }));
    await writeFile(join(directory, "truncated.json"), '{"packetId":');
    await writeFile(join(directory, "bad-identity.json"), JSON.stringify({ packetId: "old", cases: [{ requirementIds: ["B", 12] }] }));
    await writeFile(join(directory, "empty.json"), JSON.stringify({ packetId: "old", cases: [] }));
    await writeFile(join(directory, "not-a-plan.txt"), "ignored");
    await mkdir(join(directory, "nested.json"));
    const history = await readHistoricalPlanIds(directory);
    assert.deepEqual([...history.requirementIds].sort(), ["A.1", "A_1"]);
    assert.equal(history.plans, 1);
    assert.equal(history.ignoredPlans, 3);
    await writeFile(join(directory, "new-plan.json"), JSON.stringify({ packetId: "new", cases: [{ requirementIds: ["NEW"] }] }));
    assert.equal(history.requirementIds.has("NEW"), false);
  });
});

test("Missing historical plans provide no grounds to skip a requirement", async () => {
  await withTempDir("shallow-no-historical-ids-", async directory => {
    const history = await readHistoricalPlanIds(join(directory, "missing"));
    assert.equal(history.requirementIds.size, 0);
    assert.equal(history.plans, 0);
  });
});

test("Explicit ordered change headings take precedence over historical IDs", async () => {
  await withModulePipeline(async f => {
    const catalog = await loadRequirementCatalog(f.options.requirementsFile);
    catalog.requirements[0].text = modified;
    catalog.requirements[1].text = "Mention Original Feature Description and Modified Feature Description as ordinary prose.";
    const history = new Set(["A", "B", "REMOVED"]);
    assert.deepEqual(selectEvolutionScope(catalog, history), {
      addedRequirementIds: ["C"], changedRequirementIds: ["A"], inheritedRequirementIds: ["B"],
    });
    catalog.requirements[2].text = modified.replaceAll("\n", "\r\n");
    assert.deepEqual(selectEvolutionScope(catalog, history).changedRequirementIds, ["A", "C"]);
    catalog.requirements[0].text = "Modified Feature Description\nnew\nOriginal Feature Description\nold";
    assert.deepEqual(selectEvolutionScope(catalog, history).inheritedRequirementIds, ["A", "B"]);
  });
});

test("Scheduling bypasses inherited nodes while preserving dependencies on pending changes", async () => {
  await withModulePipeline(async f => {
    const catalog = await loadRequirementCatalog(f.options.requirementsFile);
    const before = structuredClone(catalog);
    const scoped = evolutionImplementationCatalog(catalog, new Set(["B"]));
    assert.deepEqual(scoped.requirements.map(item => [item.id, item.dependencyIds]), [["A", []], ["C", ["A"]]]);
    assert.deepEqual(featureGroupPackets(scoped).packets.map(item => item.requirementIds), [["A"], ["C"]]);
    assert.throws(() => featureGroupingFromIds(scoped, [["C"], ["A"]]), /must precede/);
    assert.deepEqual(catalog, before);
    assert.equal(scoped.requirements[1].text, catalog.requirements[2].text);
    assert.equal(scoped.requirements[1].scenarios, catalog.requirements[2].scenarios);
    assert.equal(evolutionImplementationCatalog(catalog, new Set()), catalog);
    assert.equal(evolutionImplementationCatalog(catalog, new Set(["A", "B", "C"])).requirements.length, 0);
  });
});

test("Both final requirement trees select five added and five modified atomics with complete initial ID history", async () => {
  for (const [product, total, inheritedCount] of [["github", 52, 42], ["sheet", 10, 0]] as const) {
    const previous = await loadRequirementCatalog(`data/official-competition/hackathon--${product}/requirements.yaml`);
    const current = await loadRequirementCatalog(`data/final/hackathon-evolution--${product}/requirements.yaml`, { inheritedApplication: true });
    const scope = selectEvolutionScope(current, new Set(previous.requirements.map(item => item.id)));
    assert.equal(scope.addedRequirementIds.length, 5);
    assert.equal(scope.changedRequirementIds.length, 5);
    assert.equal(scope.inheritedRequirementIds.length, inheritedCount);
    const scoped = evolutionImplementationCatalog(current, new Set(scope.inheritedRequirementIds));
    assert.equal(scoped.requirements.length, 10);
    assert.equal(featureGroupPackets(scoped).stats.requirements, 10);
    assert.equal(current.requirements.length, total);
  }
});

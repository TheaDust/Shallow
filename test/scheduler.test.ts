import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { loadRequirementCatalog } from "../src/catalog.js";
import { featureGroupPackets, auditPackets } from "../src/scheduler.js";
import type { AtomicRequirement, RequirementCatalog, RequirementStatus } from "../src/types.js";

test("Feature groups keep a dependency chain together under the thresholds", () => {
  const catalog = makeCatalog(Array.from({ length: 5 }, (_, i) => requirement(`R${i}`, i,
    { folder: ["ROOT", "NOTES", `SECTION${i}`], dependencies: i ? [`R${i - 1}`] : [] })));
  const { packets } = featureGroupPackets(catalog);
  assert.equal(packets.length, 1);
  assert.deepEqual(packets[0].requirementIds, ["R0", "R1", "R2", "R3", "R4"]);
  assert.deepEqual(featureGroupPackets(catalog).packets, packets);
});

test("Feature groups order by dependencies, independent of verification status", () => {
  const catalog = makeCatalog([requirement("CHILD", 0, { dependencies: ["BASE"] }), requirement("BASE", 1)], { BASE: "inconclusive" });
  assert.deepEqual(featureGroupPackets(catalog).packets.map(item => item.requirementIds), [["BASE"], ["CHILD"]]);
});

test("Cross-module dependency chains schedule atomics in order without merging modules", () => {
  const catalog = makeCatalog([
    requirement("A1", 0, { folder: ["ROOT", "A"], dependencies: ["B1"] }),
    requirement("A2", 1, { folder: ["ROOT", "A"] }),
    requirement("B1", 2, { folder: ["ROOT", "B"] }),
    requirement("B2", 3, { folder: ["ROOT", "B"], dependencies: ["A2"] }),
  ]);
  const result = featureGroupPackets(catalog);
  assert.deepEqual(result.packets.map(item => item.requirementIds), [["A2"], ["B1", "B2"], ["A1"]]);
  assert.deepEqual(result.packets.map(item => item.id), ["feature-a2-1", "feature-b1-2", "feature-a1-3"]);
  assert.deepEqual(result.stats, { packets: 3, requirements: 4, maxPacketSize: 2,
    crossModulePackets: 0, cohesionRate: 0, thresholdLimitedPackets: 0 });
  assert.deepEqual(featureGroupPackets(catalog), result);
});

test("The requirement-count threshold closes a group and overflow forms the next one", () => {
  const catalog = makeCatalog(Array.from({ length: 7 }, (_, i) =>
    requirement(`G${i + 1}`, i, { folder: ["ROOT", "M", "P"] })));
  const { packets, stats } = featureGroupPackets(catalog);
  assert.deepEqual(packets.map(item => item.requirementIds),
    [["G1", "G2", "G3", "G4", "G5", "G6"], ["G7"]]);
  assert.equal(stats.maxPacketSize, 6);
  assert.equal(stats.thresholdLimitedPackets, 1);
});

test("The scenario-count threshold skips an overflowing candidate but keeps extending", () => {
  const catalog = makeCatalog([
    requirement("S1", 0, { folder: ["ROOT", "M", "P"], scenarios: Array.from({ length: 6 }, () => "s") }),
    requirement("S2", 1, { folder: ["ROOT", "M", "P"], scenarios: Array.from({ length: 7 }, () => "s") }),
    requirement("S3", 2, { folder: ["ROOT", "M", "P"], scenarios: ["s"] }),
  ]);
  assert.deepEqual(featureGroupPackets(catalog).packets.map(item => item.requirementIds), [["S1", "S3"], ["S2"]]);
});

test("The text-size threshold skips an overflowing candidate but keeps extending", () => {
  const catalog = makeCatalog([
    requirement("T1", 0, { folder: ["ROOT", "M", "P"], text: "t".repeat(10_000) }),
    requirement("T2", 1, { folder: ["ROOT", "M", "P"], text: "t".repeat(9_000) }),
    requirement("T3", 2, { folder: ["ROOT", "M", "P"], text: "t".repeat(8_000) }),
  ]);
  assert.deepEqual(featureGroupPackets(catalog).packets.map(item => item.requirementIds), [["T1", "T3"], ["T2"]]);
});

test("A single requirement over the thresholds forms its own group", () => {
  const catalog = makeCatalog([
    requirement("SMALL1", 0, { folder: ["ROOT", "M", "P"] }),
    requirement("BIG", 1, { folder: ["ROOT", "M", "P"], text: "b".repeat(20_000) }),
    requirement("SMALL2", 2, { folder: ["ROOT", "M", "P"] }),
  ]);
  const { packets, stats } = featureGroupPackets(catalog);
  assert.deepEqual(packets.map(item => item.requirementIds), [["SMALL1", "SMALL2"], ["BIG"]]);
  assert.equal(stats.thresholdLimitedPackets, 1);
});

test("Extension prefers the same direct parent folder over declaration order", () => {
  const catalog = makeCatalog([
    requirement("S", 0, { folder: ["ROOT", "M", "P1"] }),
    requirement("Y", 1, { folder: ["ROOT", "M", "P2"] }),
    requirement("X", 2, { folder: ["ROOT", "M", "P1"] }),
  ]);
  assert.deepEqual(featureGroupPackets(catalog).packets.map(item => item.requirementIds), [["S", "X", "Y"]]);
});

test("Within one tier, dependency affinity breaks ties before declaration order", () => {
  const catalog = makeCatalog([
    requirement("D", 0, { folder: ["ROOT", "M"], scenarios: Array.from({ length: 12 }, () => "s") }),
    requirement("S", 1, { folder: ["ROOT", "M"], dependencies: ["D"] }),
    requirement("A", 2, { folder: ["ROOT", "M"], dependencies: ["S"] }),
    requirement("B", 3, { folder: ["ROOT", "M"], dependencies: ["D"] }),
    requirement("C", 4, { folder: ["ROOT", "M"] }),
  ]);
  const { packets, stats } = featureGroupPackets(catalog);
  assert.deepEqual(packets.map(item => item.requirementIds), [["D"], ["S", "A", "B", "C"]]);
  assert.deepEqual(stats, { packets: 2, requirements: 5, maxPacketSize: 4,
    crossModulePackets: 0, cohesionRate: 1 / 3, thresholdLimitedPackets: 1 });
});

test("Atomic audit covers every requirement and carries transitive textual prerequisites", () => {
  const catalog = makeCatalog([requirement("A", 0), requirement("B", 1, { dependencies: ["A"] }), requirement("C", 2, { dependencies: ["B"] })]);
  const packets = auditPackets(catalog);
  assert.deepEqual(packets.map(item => item.requirementIds), [["A"], ["B"], ["C"]]);
  assert.deepEqual(packets[2].prerequisites?.map(item => item.id), ["A", "B"]);
  assert.deepEqual(featureGroupPackets(makeCatalog([])), { packets: [], stats: { packets: 0, requirements: 0,
    maxPacketSize: 0, crossModulePackets: 0, cohesionRate: 1, thresholdLimitedPackets: 0 } });
});

test("Real requirement trees group deterministically with unique coverage", async () => {
  const expectedPackets: Record<string, number> = { "12306": 24, bookstack: 11, ctrip: 27, github: 10,
    keep: 9, prestashop: 19, sheet: 6, stackoverflow: 16, ticketbooking: 1 };
  for (const [name, count] of Object.entries(expectedPackets)) {
    const catalog = await loadRequirementCatalog(resolve(`data/${name}/requirements.yaml`));
    const { packets, stats } = featureGroupPackets(catalog);
    assert.equal(packets.length, count, `${name} packet count`);
    assert.equal(stats.requirements, catalog.requirements.length, `${name} requirement count`);
    const covered = packets.flatMap(item => item.requirementIds);
    assert.equal(new Set(covered).size, catalog.requirements.length, `${name} unique coverage`);
    assert.deepEqual(featureGroupPackets(catalog).packets.map(item => item.requirementIds),
      packets.map(item => item.requirementIds), `${name} determinism`);
  }
});

test("Sheet reproduces the six feature groups from the design document", async () => {
  const catalog = await loadRequirementCatalog(resolve("data/sheet/requirements.yaml"));
  const { packets } = featureGroupPackets(catalog);
  assert.deepEqual(packets.map(item => item.requirementIds), [
    ["REQ-1-1-1", "REQ-1-2-2", "REQ-1-2-1", "REQ-1-3-1", "REQ-1-3-2"],
    ["REQ-2-1-3", "REQ-2-1-1", "REQ-2-2-1", "REQ-2-2-2"],
    ["REQ-3-1-1", "REQ-3-1-2", "REQ-3-1-3", "REQ-3-2-1", "REQ-3-2-2"],
    ["REQ-4-1-1", "REQ-4-2-1", "REQ-4-2-2", "REQ-4-1-2"],
    ["REQ-5-1-2", "REQ-5-3-1", "REQ-5-2-1", "REQ-5-1-1"],
    ["REQ-2-1-2", "REQ-2-1-4"],
  ]);
});

function makeCatalog(
  requirements: AtomicRequirement[],
  overrides: Record<string, RequirementStatus> = {},
): RequirementCatalog {
  return {
    requirements,
    statusById: Object.fromEntries(
      requirements.map((item) => [item.id, overrides[item.id] ?? "todo"]),
    ),
  };
}

function requirement(
  id: string,
  declarationIndex: number,
  options: {
    dependencies?: string[];
    folder?: string[];
    scenarios?: string[];
    text?: string;
    uiStrings?: string[];
  } = {},
): AtomicRequirement {
  const folderPath = options.folder ?? ["ROOT", id];
  const parent = folderPath.at(-1)!;
  return {
    id,
    declarationIndex,
    folderPath,
    name: id,
    text: options.text ?? `${id} description`,
    dependencyIds: options.dependencies ?? [],
    scenarios: options.scenarios ?? [],
    references: [],
    exactUiStrings: options.uiStrings ?? [],
    product: {
      kind: "generic_web",
      rootId: "ROOT",
      rootName: "Demo Product",
      description: "Root description.",
      seedData: [],
    },
    ancestors: [{ id: parent, name: parent, description: `${parent} area` }],
  };
}

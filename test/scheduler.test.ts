import assert from "node:assert/strict";
import { test } from "node:test";
import { implementationPackets, auditPackets } from "../src/scheduler.js";
import type { AtomicRequirement, RequirementCatalog, RequirementStatus } from "../src/types.js";

test("Implementation groups complete subtrees, including internal dependencies and more than three atomics", () => {
  const catalog = makeCatalog(Array.from({ length: 5 }, (_, i) => requirement(`R${i}`, i,
    { folder: ["ROOT", "NOTES", `SECTION${i}`], dependencies: i ? [`R${i-1}`] : [] })));
  const packets = implementationPackets(catalog);
  assert.equal(packets.length, 1);
  assert.deepEqual(packets[0].requirementIds, ["R0", "R1", "R2", "R3", "R4"]);
  assert.deepEqual(implementationPackets(catalog), packets);
});

test("Implementation orders modules by dependencies, independent of verification status", () => {
  const catalog = makeCatalog([requirement("CHILD", 0, { dependencies: ["BASE"] }), requirement("BASE", 1)], { BASE: "inconclusive" });
  assert.deepEqual(implementationPackets(catalog).map(item => item.requirementIds), [["BASE"], ["CHILD"]]);
});

test("Cross-module dependency cycles merge modules without inventing atomic cycles", () => {
  const catalog = makeCatalog([
    requirement("A1", 0, { folder: ["ROOT", "A"], dependencies: ["B1"] }),
    requirement("A2", 1, { folder: ["ROOT", "A"] }),
    requirement("B1", 2, { folder: ["ROOT", "B"] }),
    requirement("B2", 3, { folder: ["ROOT", "B"], dependencies: ["A2"] }),
  ]);
  assert.deepEqual(implementationPackets(catalog).map(item => item.requirementIds), [["A1", "A2", "B1", "B2"]]);
});

test("Atomic audit covers every requirement and carries transitive textual prerequisites", () => {
  const catalog = makeCatalog([requirement("A", 0), requirement("B", 1, { dependencies: ["A"] }), requirement("C", 2, { dependencies: ["B"] })]);
  const packets = auditPackets(catalog);
  assert.deepEqual(packets.map(item => item.requirementIds), [["A"], ["B"], ["C"]]);
  assert.deepEqual(packets[2].prerequisites?.map(item => item.id), ["A", "B"]);
  assert.deepEqual(implementationPackets(makeCatalog([])), []);
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
    text: `${id} description`,
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

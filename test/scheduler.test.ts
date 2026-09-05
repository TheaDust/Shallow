import assert from "node:assert/strict";
import { test } from "node:test";

import { selectNextPacket } from "../src/scheduler.js";
import type {
  AtomicRequirement,
  RequirementCatalog,
  RequirementStatus,
} from "../src/types.js";

test("Scheduler excludes requirements whose dependencies are not verified", () => {
  const catalog = makeCatalog([
    requirement("BASE", 0, { scenarios: ["Base path"] }),
    requirement("DEPENDENT", 1, {
      dependencies: ["BASE"],
      scenarios: ["Dependent path", "Dependent refresh"],
    }),
  ]);

  const packet = selectNextPacket(catalog);

  assert.deepEqual(packet?.requirementIds, ["BASE"]);
});

test("Scheduler prefers scenario count then direct dependents", () => {
  const catalog = makeCatalog([
    requirement("SCENARIOS", 0, { scenarios: ["One", "Two"] }),
    requirement("CENTRAL", 1, { scenarios: ["One"] }),
    requirement("LEAF", 2, {
      dependencies: ["CENTRAL"],
      scenarios: ["Blocked"],
    }),
  ]);

  assert.equal(selectNextPacket(catalog)?.requirementIds[0], "SCENARIOS");

  catalog.requirements[0].scenarios = ["One"];
  assert.equal(selectNextPacket(catalog)?.requirementIds[0], "CENTRAL");
});

test("Scheduler groups at most three related ready requirements in one folder", () => {
  const catalog = makeCatalog([
    requirement("REQ-A", 0, {
      folder: ["ROOT", "PROFILE"],
      scenarios: ["Create profile"],
      uiStrings: ["Profile"],
    }),
    requirement("REQ-B", 1, {
      folder: ["ROOT", "PROFILE"],
      scenarios: ["Edit profile"],
    }),
    requirement("REQ-C", 2, {
      folder: ["ROOT", "PROFILE"],
      scenarios: ["Delete profile"],
    }),
    requirement("REQ-D", 3, {
      folder: ["ROOT", "PROFILE"],
      scenarios: ["Archive profile"],
    }),
    requirement("REQ-E", 4, {
      folder: ["ROOT", "OTHER"],
      scenarios: ["Profile report"],
    }),
  ]);

  const first = selectNextPacket(catalog);
  const second = selectNextPacket(catalog);

  assert.deepEqual(first?.requirementIds, ["REQ-A", "REQ-B", "REQ-C"]);
  assert.equal(first?.id, "packet-req-a__req-b__req-c");
  assert.deepEqual(second, first);
});

test("Scheduler never returns blocked requirements", () => {
  const catalog = makeCatalog(
    [
      requirement("BLOCKED", 0, { scenarios: ["One", "Two", "Three"] }),
      requirement("READY", 1, { scenarios: ["Ready"] }),
    ],
    { BLOCKED: "blocked" },
  );

  assert.deepEqual(selectNextPacket(catalog)?.requirementIds, ["READY"]);
});

test("Scheduler returns undefined when no requirement is ready", () => {
  const catalog = makeCatalog(
    [
      requirement("BLOCKED", 0),
      requirement("WAITING", 1, { dependencies: ["BLOCKED"] }),
    ],
    { BLOCKED: "blocked" },
  );

  assert.equal(selectNextPacket(catalog), undefined);
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
    },
    ancestors: [{ id: parent, name: parent, description: `${parent} area` }],
  };
}

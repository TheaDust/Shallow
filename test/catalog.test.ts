import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { loadRequirementCatalog } from "../src/catalog.js";

const fixture = resolve("test/fixtures/requirements.yaml");

test("Catalog preserves atomic requirements and source evidence in declaration order", async () => {
  const catalog = await loadRequirementCatalog(fixture);

  assert.deepEqual(
    catalog.requirements.map((requirement) => requirement.id),
    ["REQ-A", "REQ-B", "REQ-C"],
  );
  assert.deepEqual(catalog.statusById, {
    "REQ-A": "todo",
    "REQ-B": "todo",
    "REQ-C": "todo",
  });

  const first = catalog.requirements[0];
  assert.deepEqual(first.folderPath, ["ROOT", "AREA-A"]);
  assert.equal(first.declarationIndex, 0);
  assert.equal(first.name, "Create a profile");
  assert.match(first.text, /keeps the value/);
  assert.deepEqual(first.dependencyIds, []);
  assert.deepEqual(first.references, ["reference/profile.png"]);
  assert.deepEqual(first.exactUiStrings, [
    "Profile name",
    "Save",
    "Profile name",
    "Save",
    "Save",
    "Name is required",
  ]);
  assert.deepEqual(first.scenarios, [
    "Save a profile\nGIVEN: The profile page is open.\nWHEN: The user fills “Profile name” and clicks `Save`.\nTHEN: The saved name remains visible after refresh.",
    "Reject an empty profile\nWHEN: The user clicks `Save` without a name.\nTHEN: The page displays “Name is required”.",
  ]);
  assert.deepEqual(first.product, {
    kind: "generic_web",
    rootId: "ROOT",
    rootName: "Demo Product",
    description: "Root description.",
    seedData: [],
  });
  assert.deepEqual(first.ancestors, [
    { id: "AREA-A", name: "Account Area", description: "Account features." },
  ]);
});

test("Catalog classifies known product roots exactly and unknown roots as generic web", async () => {
  await withYaml(
    `id: ROOT\nname: GitHub Collaboration Platform Core Requirements\ntype: FOLDER\ndependencies: []\nchildren:\n  - id: X\n    name: One\n    type: ATOMIC\n    dependencies: []\n    description: One\n`,
    async (file) => {
      const catalog = await loadRequirementCatalog(file);
      assert.equal(
        catalog.requirements[0].product.kind,
        "repository_collaboration",
      );
    },
  );
  await withYaml(
    `id: ROOT\nname: Core Requirements for an Online Spreadsheet Data Workspace\ntype: FOLDER\ndependencies: []\nchildren:\n  - id: X\n    name: One\n    type: ATOMIC\n    dependencies: []\n    description: One\n`,
    async (file) => {
      const catalog = await loadRequirementCatalog(file);
      assert.equal(catalog.requirements[0].product.kind, "spreadsheet");
    },
  );
  await withYaml(
    `id: ROOT\nname: Something Else\ntype: FOLDER\ndependencies: []\nchildren:\n  - id: X\n    name: One\n    type: ATOMIC\n    dependencies: []\n    description: One\n`,
    async (file) => {
      const catalog = await loadRequirementCatalog(file);
      assert.equal(catalog.requirements[0].product.kind, "generic_web");
    },
  );
});

test("Catalog rejects duplicate identifiers", async () => {
  await withYaml(
    `id: ROOT\nname: Root\ntype: FOLDER\ndependencies: []\nchildren:\n  - id: X\n    name: One\n    type: ATOMIC\n    dependencies: []\n    description: One\n  - id: X\n    name: Two\n    type: ATOMIC\n    dependencies: []\n    description: Two\n`,
    async (file) => {
      await assert.rejects(loadRequirementCatalog(file), /Duplicate requirement id: X/);
    },
  );
});

test("Catalog rejects unknown dependencies", async () => {
  await withYaml(
    `id: ROOT\nname: Root\ntype: FOLDER\ndependencies: []\nchildren:\n  - id: X\n    name: One\n    type: ATOMIC\n    dependencies: [MISSING]\n    description: One\n`,
    async (file) => {
      await assert.rejects(loadRequirementCatalog(file), /Unknown dependency MISSING/);
    },
  );
});

test("Catalog rejects dependency cycles", async () => {
  await withYaml(
    `id: ROOT\nname: Root\ntype: FOLDER\ndependencies: []\nchildren:\n  - id: X\n    name: One\n    type: ATOMIC\n    dependencies: [Y]\n    description: One\n  - id: Y\n    name: Two\n    type: ATOMIC\n    dependencies: [X]\n    description: Two\n`,
    async (file) => {
      await assert.rejects(loadRequirementCatalog(file), /Dependency cycle/);
    },
  );
});

test("Catalog reads only the explicitly selected YAML file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shallow-catalog-"));
  try {
    const selected = join(directory, "requirements.yaml");
    await writeFile(
      selected,
      "id: ROOT\nname: Root\ntype: FOLDER\ndependencies: []\nchildren: []\n",
    );
    await writeFile(join(directory, "sibling.yaml"), "not: [valid");

    const catalog = await loadRequirementCatalog(selected);

    assert.deepEqual(catalog.requirements, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Catalog keeps original folder dependencies, explicit scenario IDs and empty folders for ARC", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shallow-catalog-tree-"));
  try {
    const path = join(directory, "requirements.yaml");
    await writeFile(path, JSON.stringify({ id: "ROOT", name: "Root", type: "ROOT", children: [
      { id: "EMPTY", name: "Empty", type: "FOLDER", scenarios: [{ id: "S-EMPTY", name: "Folder scenario", steps: [] }] },
      { id: "BASE", name: "Base", type: "FOLDER", children: [{ id: "A", name: "A", type: "ATOMIC" }] },
      { id: "FOLLOW", name: "Follow", type: "FOLDER", dependencies: ["BASE"], visual_reference: ["reference/folder.png"],
        children: [{ id: "B", name: "B", type: "ATOMIC", scenarios: [{ id: "S-B", name: "Custom", steps: [] }] }] },
    ] }));
    const catalog = await loadRequirementCatalog(path);
    assert.deepEqual(catalog.tree.children.map((node) => node.id), ["EMPTY", "BASE", "FOLLOW"]);
    assert.deepEqual(catalog.tree.children[2].dependencies, ["BASE"]);
    assert.deepEqual(catalog.tree.children[2].visual_reference, ["reference/folder.png"]);
    assert.equal(catalog.tree.children[2].children[0].scenarios[0].id, "S-B");
    assert.deepEqual(catalog.requirements.find((node) => node.id === "B")?.dependencyIds, ["A"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Catalog expands folder dependencies and inherits ancestor prerequisites", async () => {
  const catalog = await loadRequirementCatalog(resolve("data/github/requirements.yaml"));
  const atomicIds = new Set(catalog.requirements.map((item) => item.id));
  for (const item of catalog.requirements) {
    assert.ok(item.dependencyIds.every((id) => atomicIds.has(id)), item.id);
  }
  const folderLeaves = catalog.requirements.filter((item) => item.folderPath.includes("REQ-4-3")).map((item) => item.id);
  assert.ok(folderLeaves.length > 0);
  const dependents = catalog.requirements.filter((item) => item.folderPath.includes("REQ-6-2"));
  assert.ok(dependents.length > 0);
  for (const dependent of dependents) {
    assert.ok(folderLeaves.every((id) => dependent.dependencyIds.includes(id)));
  }
});

test("Catalog drops vacuous self and enclosing-folder dependencies", async () => {
  await withYaml("id: ROOT\nname: Root\ntype: ROOT\nchildren:\n  - id: AREA\n    name: Area\n    type: FOLDER\n    children:\n      - id: X\n        name: One\n        type: ATOMIC\n        dependencies: [AREA, X]\n", async (file) => {
    const catalog = await loadRequirementCatalog(file);
    assert.deepEqual(catalog.requirements[0].dependencyIds, []);
  });
});

test("Catalog keeps cross-subtree ordering while ignoring a folder dependency on its own ancestor", async () => {
  const yaml = [
    "id: ROOT",
    "name: Root",
    "type: ROOT",
    "children:",
    "  - id: P",
    "    name: Parent",
    "    type: FOLDER",
    "    dependencies: []",
    "    children:",
    "      - id: A",
    "        name: First",
    "        type: ATOMIC",
    "        dependencies: []",
    "      - id: F",
    "        name: Nested",
    "        type: FOLDER",
    "        dependencies: [P]",
    "        children:",
    "          - id: B",
    "            name: Second",
    "            type: ATOMIC",
    "            dependencies: [A]",
  ].join("\n");
  await withYaml(`${yaml}\n`, async (file) => {
    const catalog = await loadRequirementCatalog(file);
    const byId = new Map(catalog.requirements.map((item) => [item.id, item]));
    assert.deepEqual(byId.get("A")?.dependencyIds, []);
    assert.deepEqual(byId.get("B")?.dependencyIds, ["A"]);
  });
});

test("Catalog parses top-level seed data into the product context", async () => {
  await withYaml(
    `id: ROOT\nname: Root\ntype: FOLDER\ndependencies: []\nchildren:\n  - id: X\n    name: One\n    type: ATOMIC\n    dependencies: []\n    description: One\ndata:\n  - category: Account Seed Data\n    items:\n      - Verified accounts can sign in by username or verified email.\n      - Recovery displays the fixed verification code `+"`123456`"+`.\n  - category: Repository Seed Data\n    items:\n      - A public organization with one public repository.\n`,
    async (file) => {
      const catalog = await loadRequirementCatalog(file);
      assert.deepEqual(catalog.requirements[0].product.seedData, [
        {
          category: "Account Seed Data",
          items: [
            "Verified accounts can sign in by username or verified email.",
            "Recovery displays the fixed verification code `123456`.",
          ],
        },
        {
          category: "Repository Seed Data",
          items: ["A public organization with one public repository."],
        },
      ]);
    },
  );
});

test("Catalog reads seed data from the bundled requirement files", async () => {
  for (const file of ["data/github/requirements.yaml", "data/sheet/requirements.yaml"]) {
    const catalog = await loadRequirementCatalog(resolve(file));
    const { seedData } = catalog.requirements[0].product;
    assert.ok(seedData.length > 0, file);
    for (const entry of seedData) {
      assert.ok(entry.category.length > 0, file);
      assert.ok(entry.items.length > 0, file);
    }
  }
  const github = await loadRequirementCatalog(resolve("data/github/requirements.yaml"));
  assert.equal(github.requirements[0].product.seedData[0].category, "Account and Permission Seed Data");
});

test("Catalog rejects malformed seed data", async () => {
  await withYaml(
    `id: ROOT\nname: Root\ntype: FOLDER\ndependencies: []\nchildren: []\ndata:\n  - category: 42\n    items: []\n`,
    async (file) => {
      await assert.rejects(loadRequirementCatalog(file), /root\.data\[0\]\.category must be a string/);
    },
  );
  await withYaml(
    `id: ROOT\nname: Root\ntype: FOLDER\ndependencies: []\nchildren: []\ndata: not-a-list\n`,
    async (file) => {
      await assert.rejects(loadRequirementCatalog(file), /root\.data must be an array/);
    },
  );
});

async function withYaml(
  contents: string,
  callback: (file: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "shallow-catalog-"));
  const file = join(directory, "requirements.yaml");
  try {
    await writeFile(file, contents);
    await callback(file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

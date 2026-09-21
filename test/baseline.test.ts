import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

import { BASELINE_CONTEXT_WINDOW, deriveBaselinePromptTimeoutMs, loadRootModules } from "../baseline/index.js";
import { deriveModelTimeouts } from "../src/runtime-config.js";

const fixture = resolve("test/fixtures/requirements.yaml");

test("baseline gives ROOT subtrees twice the main packet timeout while retaining budget scaling", () => {
  assert.equal(deriveBaselinePromptTimeoutMs(0), 16_200_000);
  assert.equal(deriveBaselinePromptTimeoutMs(600_000), 480_000);
  assert.equal(deriveBaselinePromptTimeoutMs(10_000_000), 8_000_000);
  assert.equal(deriveModelTimeouts(0).builderTimeoutMs, 5_400_000);
});

test("loadRootModules splits ROOT direct children in declaration order", async () => {
  const document = parse(await readFile(fixture, "utf8"));
  const modules = loadRootModules(document);

  assert.deepEqual(
    modules.map((module) => module.id),
    ["AREA-A", "AREA-B"],
  );
  assert.deepEqual(
    modules.map((module) => [module.index, module.total]),
    [
      [1, 2],
      [2, 2],
    ],
  );
  assert.equal(modules[0].name, "Account Area");
  assert.deepEqual(modules[0].subtree.children, [
    {
      id: "REQ-A",
      name: "Create a profile",
      type: "ATOMIC",
      dependencies: [],
      description:
        "The page shows “Profile name”, a `Save` button, and keeps the value.\nScreenshot reference:\n![profile](reference/profile.png)",
      scenarios: [
        {
          name: "Save a profile",
          steps: [
            { keyword: "GIVEN", content: "The profile page is open." },
            { keyword: "WHEN", content: "The user fills “Profile name” and clicks `Save`." },
            { keyword: "THEN", content: "The saved name remains visible after refresh." },
          ],
        },
        {
          name: "Reject an empty profile",
          steps: [
            { keyword: "WHEN", content: "The user clicks `Save` without a name." },
            { keyword: "THEN", content: "The page displays “Name is required”." },
          ],
        },
      ],
    },
    {
      id: "REQ-B",
      name: "Edit a profile",
      type: "ATOMIC",
      dependencies: ["REQ-A"],
      description: "The user can edit “Profile name” and click `Save changes`.",
      scenarios: [
        {
          name: "Edit the saved profile",
          steps: [
            { keyword: "GIVEN", content: "A saved profile exists." },
            { keyword: "THEN", content: "The edited value persists." },
          ],
        },
      ],
    },
  ]);
});

test("loadRootModules rejects documents without a ROOT mapping", () => {
  assert.throws(() => loadRootModules({ id: "NOT-ROOT", children: [{ id: "A" }] }), /ROOT mapping/);
  assert.throws(() => loadRootModules(null), /ROOT mapping/);
  assert.throws(() => loadRootModules(["ROOT"]), /ROOT mapping/);
});

test("loadRootModules rejects ROOT without child modules", () => {
  assert.throws(() => loadRootModules({ id: "ROOT" }), /at least one child/);
  assert.throws(() => loadRootModules({ id: "ROOT", children: [] }), /at least one child/);
});

test("loadRootModules rejects children without ids", () => {
  assert.throws(() => loadRootModules({ id: "ROOT", children: [{ name: "No id" }] }), /has no id/);
});

test("baseline system prompt mirrors the shared platform contract wording", async () => {
  const prompt = await readFile(resolve("baseline/system.md"), "utf8");
  for (const anchor of [
    "目标应用由 frontend 和 backend 两个目录组成。",
    "后端必须读取 PORT 环境变量，未设置时使用 3000。",
    "前端必须通过同源相对路径调用后端，不得在构建产物中硬编码主机或端口。",
    "npm run build",
    "npm run start",
    "/health",
    "/api/health",
    "未知路径",
    "404",
    "ROOT 的一个直接子树",
  ]) {
    assert.ok(prompt.includes(anchor), anchor);
  }
  // The baseline reads the file verbatim: no template placeholders and no packet concepts.
  assert.doesNotMatch(prompt, /\{\{/);
  assert.doesNotMatch(prompt, /工作包|PACKET/);
});

test("baseline asks the shared worker for a 1M context window", () => {
  assert.equal(BASELINE_CONTEXT_WINDOW, 1_000_000);
});

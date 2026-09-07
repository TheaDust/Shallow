import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

import { deriveBaselinePromptTimeoutMs, loadRootModules, promptWithTimeout } from "../baseline/index.js";
import { deriveModelTimeouts } from "../src/runtime-config.js";

const fixture = resolve("test/fixtures/requirements.yaml");

test("baseline gives ROOT subtrees twice the main packet timeout while retaining budget scaling", () => {
  assert.equal(deriveBaselinePromptTimeoutMs(0), 10_800_000);
  assert.equal(deriveBaselinePromptTimeoutMs(600_000), 480_000);
  assert.equal(deriveBaselinePromptTimeoutMs(10_000_000), 7_200_000);
  assert.equal(deriveModelTimeouts(0).builderTimeoutMs, 3_600_000);
});

test("baseline waits for the aborted prompt to settle before returning a timeout", async () => {
  let settled = false;
  let rejectPrompt!: (error: Error) => void;
  const outcome = await promptWithTimeout({
    prompt: async () => new Promise<string>((_resolve, reject) => { rejectPrompt = reject; }),
    abort: async () => {
      setTimeout(() => {
        settled = true;
        rejectPrompt(new Error("MessageAbortedError"));
      }, 20);
    },
  }, "session", { systemPrompt: "system", taskPrompt: "module" }, 5, 200);
  assert.equal(outcome, "timed_out");
  assert.equal(settled, true);
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

test("baseline stops when abort or prompt cleanup cannot finish", async () => {
  for (const phase of ["abort", "prompt"] as const) {
    await assert.rejects(promptWithTimeout({
      prompt: async () => new Promise<string>(() => {}),
      abort: async () => phase === "abort" ? new Promise<void>(() => {}) : undefined,
    }, "session", { systemPrompt: "system", taskPrompt: "module" }, 5, 10),
    new RegExp(`${phase} cleanup timed out`));
  }
  await assert.rejects(promptWithTimeout({
    prompt: async () => new Promise<string>(() => {}),
    abort: async () => { throw new Error("abort unavailable"); },
  }, "session", { systemPrompt: "system", taskPrompt: "module" }, 5, 10), /abort unavailable/);
});

test("baseline returns ordinary completion and model failure without aborting", async () => {
  for (const outcome of ["completed", "failed"] as const) {
    assert.equal(await promptWithTimeout({
      prompt: async () => {
        if (outcome === "failed") throw new Error("model unavailable");
        return "done";
      },
      abort: async () => { assert.fail("settled request must not be aborted"); },
    }, "session", { systemPrompt: "system", taskPrompt: "module" }, 100), outcome);
  }
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

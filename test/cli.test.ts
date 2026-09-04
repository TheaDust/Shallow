import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { parseCliArgs } from "../src/cli.js";

test("CLI resolves required paths and parses a positive budget", () => {
  const parsed = parseCliArgs([
    "--requirements-dir",
    "C:/fixture/requirements",
    "--output-dir",
    "C:/fixture/output",
    "--budget-ms",
    "600000",
  ]);

  assert.deepEqual(parsed, {
    requirementsDir: resolve("C:/fixture/requirements"),
    outputDir: resolve("C:/fixture/output"),
    budgetMs: 600_000,
  });
});

test("CLI rejects a missing required path", () => {
  assert.throws(
    () =>
      parseCliArgs([
        "--requirements-dir",
        "C:/fixture/requirements",
        "--budget-ms",
        "600000",
      ]),
    /--output-dir/,
  );
});

test("CLI treats an omitted budget as unlimited", () => {
  const parsed = parseCliArgs([
    "--requirements-dir",
    "C:/fixture/requirements",
    "--output-dir",
    "C:/fixture/output",
  ]);

  assert.deepEqual(parsed, {
    requirementsDir: resolve("C:/fixture/requirements"),
    outputDir: resolve("C:/fixture/output"),
    budgetMs: 0,
  });
});

test("CLI accepts an explicit zero budget as unlimited", () => {
  const parsed = parseCliArgs([
    "--requirements-dir",
    "C:/fixture/requirements",
    "--output-dir",
    "C:/fixture/output",
    "--budget-ms",
    "0",
  ]);

  assert.equal(parsed.budgetMs, 0);
});

test("CLI rejects a negative or non-integer budget", () => {
  for (const budget of ["-1", "2.5", "nope"]) {
    assert.throws(
      () =>
        parseCliArgs([
          "--requirements-dir",
          "C:/fixture/requirements",
          "--output-dir",
          "C:/fixture/output",
          "--budget-ms",
          budget,
        ]),
      /--budget-ms/,
    );
  }
});

test("CLI rejects unknown arguments", () => {
  assert.throws(
    () =>
      parseCliArgs([
        "--requirements-dir",
        "C:/fixture/requirements",
        "--output-dir",
        "C:/fixture/output",
        "--budget-ms",
        "600000",
        "--mystery",
        "value",
      ]),
    /--mystery/,
  );
});

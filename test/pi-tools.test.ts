import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { assertToolCommand, assertToolPath } from "../src/builder/pi-tools.js";
import { withTempDir } from "./helpers/temp-dir.js";

test("Builder tools cannot reach the product-visible progress journal", async () => {
  await withTempDir("shallow-pi-tools-", async (root) => {
    await mkdir(join(root, "shallow-progress", "plans"), { recursive: true });
    await writeFile(join(root, "shallow-progress", "plans", "a.json"), "{}", "utf8");
    await mkdir(join(root, ".arc", "traceability"), { recursive: true });
    await writeFile(join(root, ".arc", "traceability", "requirements.json"), "{}", "utf8");
    await mkdir(join(root, "frontend"), { recursive: true });
    await writeFile(join(root, "frontend", "main.js"), "", "utf8");

    await assert.rejects(assertToolPath(root, "shallow-progress/plans/a.json"), /private controller evidence/);
    await assert.rejects(assertToolPath(root, ".arc/traceability/requirements.json"), /private controller evidence/);
    await assert.doesNotReject(assertToolPath(root, "frontend/main.js"));

    assert.throws(() => assertToolCommand("cat shallow-progress/progress.log"));
    assert.throws(() => assertToolCommand("type .arc\\runner-events.jsonl"));
    assert.doesNotThrow(() => assertToolCommand("npm test"));
  });
});

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { PlanCache } from "../src/judge/plan-cache.js";
import type { ProbePlan } from "../src/judge/probe-schema.js";
import { withTempDir } from "./helpers/temp-dir.js";

function plan(packetId: string, covered: string[]): ProbePlan {
  return {
    packetId,
    cases: [{ id: "case-1", requirementIds: covered, purpose: "happy_path",
      steps: [{ op: "goto", path: "/" }, { op: "expectVisible", locator: { by: "role", role: "main" } }] }],
  };
}

test("A cached plan is reused only when it still validates against its packet", async () => {
  await withTempDir("shallow-plan-cache-", async directory => {
    const cache = new PlanCache(directory);
    await cache.write("packet-a", plan("packet-a", ["A", "B"]));
    assert.equal((await cache.read({ id: "packet-a", requirementIds: ["A", "B"] }))?.packetId, "packet-a");
    // The same entry must not be reused for a packet whose coverage it fails.
    assert.equal(await cache.read({ id: "packet-a", requirementIds: ["A", "C"] }), undefined);
    assert.equal(await cache.read({ id: "packet-b", requirementIds: ["A", "B"] }), undefined);
  });
});

test("Cache files stay separate for packet ids that sanitise identically", async () => {
  await withTempDir("shallow-plan-cache-", async directory => {
    const cache = new PlanCache(directory);
    await cache.write("packet-a:1", plan("packet-a:1", ["A"]));
    await cache.write("packet-a/1", plan("packet-a/1", ["B"]));
    assert.equal((await cache.read({ id: "packet-a:1", requirementIds: ["A"] }))?.packetId, "packet-a:1");
    assert.equal((await cache.read({ id: "packet-a/1", requirementIds: ["B"] }))?.packetId, "packet-a/1");
    assert.equal((await readdir(`${directory}/plans`)).length, 2);
  });
});

test("Plan cache mirrors writes into the product-visible directory", async () => {
  await withTempDir("shallow-plan-cache-", async (directory) => {
    const mirror = join(directory, "shallow-progress", "plans");
    const cache = new PlanCache(directory, mirror);
    await cache.write("packet-a", plan("packet-a", ["A"]));

    const files = await readdir(mirror);
    assert.equal(files.length, 1);
    assert.equal(JSON.parse(await readFile(join(mirror, files[0]), "utf8")).packetId, "packet-a");
  });
});

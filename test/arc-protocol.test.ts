import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import {
  ArcEventSink,
  arcTimestamp,
  buildArcRequirementRows,
} from "../src/arc-protocol.js";
import type { AtomicRequirement } from "../src/types.js";
import { withTempDir } from "./helpers/temp-dir.js";

test("ARC event sink initializes the .arc protocol tables", async () => {
  await withTempDir("shallow-arc-", async (directory) => {
    const outputDir = join(directory, "output");
    const sink = new ArcEventSink(outputDir);

    await sink.init();

    const traceDir = join(outputDir, ".arc", "traceability");
    const tables = await readdir(traceDir);
    assert.deepEqual(tables.sort(), [
      "call_edges.json",
      "interfaces.json",
      "node_contracts.json",
      "node_states.json",
      "requirements.json",
      "scenarios.json",
      "tests.json",
    ]);
    assert.equal(await readFile(join(traceDir, "tests.json"), "utf8"), "{}\n");
  });
});

test("ARC event sink appends runner state events with UTC timestamps", async () => {
  await withTempDir("shallow-arc-", async (directory) => {
    const sink = new ArcEventSink(join(directory, "output"));
    await sink.init();

    await sink.runnerState("running", "pipeline started");
    await sink.runnerState("completed");

    const lines = await readEvents(directory);
    assert.equal(lines.length, 2);
    assert.deepEqual(Object.keys(lines[0]).sort(), [
      "message",
      "state",
      "timestamp",
      "type",
    ]);
    assert.equal(lines[0].type, "runner_state");
    assert.equal(lines[0].state, "running");
    assert.equal(lines[0].message, "pipeline started");
    assert.equal(lines[1].message, null);
    assert.match(lines[0].timestamp as string, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

test("ARC event sink records requirement states and node_states table", async () => {
  await withTempDir("shallow-arc-", async (directory) => {
    const sink = new ArcEventSink(join(directory, "output"));
    await sink.init();

    await sink.requirementState("REQ-PROFILE", "implement", "running");
    await sink.requirementState("REQ-PROFILE", "implement", "completed");
    await sink.requirementState("REQ-PROFILE", "test", "passed");

    const lines = await readEvents(directory);
    assert.deepEqual(
      lines.map((line) => [line.phase, line.status]),
      [
        ["implement", "running"],
        ["implement", "completed"],
        ["test", "passed"],
      ],
    );
    const nodeStates = JSON.parse(
      await readFile(
        join(directory, "output", ".arc", "traceability", "node_states.json"),
        "utf8",
      ),
    ) as Record<string, { req_id: string; state: string; phase: string }>;
    assert.deepEqual(Object.keys(nodeStates), ["REQ-PROFILE"]);
    assert.equal(nodeStates["REQ-PROFILE"].state, "PASSED");
    assert.equal(nodeStates["REQ-PROFILE"].phase, "test");
  });
});

test("ARC event sink stores requirement and scenario rows atomically", async () => {
  await withTempDir("shallow-arc-", async (directory) => {
    const sink = new ArcEventSink(join(directory, "output"));
    await sink.init();

    const rows = buildArcRequirementRows([atomicRequirement()]);
    await sink.storeRequirementTree(rows.requirementRows, rows.scenarioRows);

    const requirements = JSON.parse(
      await readFile(
        join(directory, "output", ".arc", "traceability", "requirements.json"),
        "utf8",
      ),
    ) as Record<string, { req_id: string; name: string; parent_id: string | null }>;
    assert.deepEqual(Object.keys(requirements), ["REQ-PROFILE"]);
    assert.equal(requirements["REQ-PROFILE"].name, "Save a profile");
    assert.equal(requirements["REQ-PROFILE"].parent_id, "PROFILE");

    const scenarios = JSON.parse(
      await readFile(
        join(directory, "output", ".arc", "traceability", "scenarios.json"),
        "utf8",
      ),
    ) as Record<string, { scenario_id: string; req_id: string; steps: unknown[] }>;
    assert.deepEqual(Object.keys(scenarios), ["REQ-PROFILE::0"]);
    assert.equal(scenarios["REQ-PROFILE::0"].req_id, "REQ-PROFILE");
    assert.equal(scenarios["REQ-PROFILE::0"].steps.length, 2);

    const lines = await readEvents(directory);
    assert.equal(
      lines.some((line) => line.type === "signal" && line.reason === "requirement_tree_stored"),
      true,
    );
  });
});

test("ARC event sink emits commit history refresh signals", async () => {
  await withTempDir("shallow-arc-", async (directory) => {
    const sink = new ArcEventSink(join(directory, "output"));
    await sink.init();

    await sink.commitHistorySignal("git_commit");

    const lines = await readEvents(directory);
    const signal = lines.find((line) => line.type === "signal") as {
      reason: string;
      refresh: Record<string, boolean>;
    };
    assert.equal(signal.reason, "git_commit");
    assert.equal(signal.refresh.commit_history, true);
    assert.equal(signal.refresh.submission, false);
  });
});

test("ARC timestamp renders UTC in platform format", () => {
  const timestamp = arcTimestamp(new Date(Date.UTC(2026, 8, 4, 12, 34, 56)));
  assert.equal(timestamp, "2026-09-04 12:34:56");
});

test("ARC requirement rows reconstruct steps from flattened scenarios", () => {
  const rows = buildArcRequirementRows([atomicRequirement()]);

  assert.deepEqual(Object.keys(rows.requirementRows), ["REQ-PROFILE"]);
  const row = rows.requirementRows["REQ-PROFILE"];
  assert.equal(row.description, "Keep a profile name after refresh.");
  assert.deepEqual(row.dependencies, []);
  assert.deepEqual(row.visual_reference, []);
  assert.deepEqual(row.children_ids, []);
  const scenario = rows.scenarioRows["REQ-PROFILE::0"];
  assert.deepEqual(scenario.steps, [
    { keyword: "WHEN", content: "The user enters a profile name and saves." },
    { keyword: "THEN", content: "The same name remains after refresh." },
  ]);
});

async function readEvents(
  directory: string,
): Promise<Array<Record<string, unknown>>> {
  const content = await readFile(
    join(directory, "output", ".arc", "runner-events.jsonl"),
    "utf8",
  );
  return content
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function atomicRequirement(): AtomicRequirement {
  return {
    id: "REQ-PROFILE",
    folderPath: ["ROOT", "PROFILE"],
    declarationIndex: 0,
    name: "Save a profile",
    text: "Keep a profile name after refresh.",
    dependencyIds: [],
    scenarios: [
      "Save and refresh\nWHEN: The user enters a profile name and saves.\nTHEN: The same name remains after refresh.",
    ],
    references: [],
    exactUiStrings: [],
  };
}

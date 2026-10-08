import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import {
  EVO_CASE_SENSITIVE_WORKBOOK_ID,
  EVO_CASE_SENSITIVE_WORKSHEET_ID,
  EVO_FIND_NEXT_WORKBOOK_ID,
  EVO_FIND_NEXT_WORKSHEET_ID,
  EVO_REPLACE_ALL_WORKBOOK_ID,
  EVO_REPLACE_ALL_WORKSHEET_ID,
  INVALID_CELL_UPDATE_MESSAGE,
  createSeedState,
} from "../src/store/workbooks.mjs";

async function startApp({ state } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-replace-"));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-dist-"));
  await mkdir(join(staticRoot, "assets"), { recursive: true });
  await writeFile(join(staticRoot, "index.html"), "<!doctype html><div id=\"root\"></div>", "utf8");
  if (state) await writeFile(join(dataDir, "workbooks.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const server = createServer(createRequestHandler({ dataDir, staticRoot }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return {
    dataDir,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async stop() {
      await new Promise((done) => server.close(done));
    },
    /** Second server on the same data directory, as after a restart. */
    async restart() {
      await new Promise((done) => server.close(done));
      const restarted = createServer(createRequestHandler({ dataDir, staticRoot }));
      await new Promise((done) => restarted.listen(0, "127.0.0.1", done));
      return {
        baseUrl: `http://127.0.0.1:${restarted.address().port}`,
        async stop() {
          await new Promise((done) => restarted.close(done));
        },
      };
    },
  };
}

async function json(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

function detail(baseUrl, workbookId) {
  return json(baseUrl, `/api/workbooks/${workbookId}`);
}

function replace(baseUrl, workbookId, worksheetId, updates) {
  return json(baseUrl, `/api/workbooks/${workbookId}/worksheets/${worksheetId}/cells/replace`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ updates }),
  });
}

test("pre-provisions the find-and-replace workbooks with their matching cells", async () => {
  const app = await startApp();
  try {
    const findNext = await detail(app.baseUrl, EVO_FIND_NEXT_WORKBOOK_ID);
    assert.equal(findNext.status, 200);
    const findSheet = findNext.body.workbook.worksheets[0];
    assert.equal(findSheet.id, EVO_FIND_NEXT_WORKSHEET_ID);
    assert.equal(findSheet.name, "Narrative");
    assert.deepEqual([findSheet.cells.E4, findSheet.cells.E7, findSheet.cells.E11], ["Cobalt", "Cobalt", "Cobalt"]);
    // No other cell of the sheet matches `Cobalt` without regard to letter case.
    assert.equal(
      Object.values(findSheet.cells).filter((value) => String(value).toLowerCase() === "cobalt").length,
      3,
    );

    const replaceAll = await detail(app.baseUrl, EVO_REPLACE_ALL_WORKBOOK_ID);
    const replaceSheet = replaceAll.body.workbook.worksheets[0];
    assert.equal(replaceSheet.id, EVO_REPLACE_ALL_WORKSHEET_ID);
    assert.equal(replaceSheet.name, "Narrative");
    assert.deepEqual(
      [replaceSheet.cells.F3, replaceSheet.cells.F6, replaceSheet.cells.F9, replaceSheet.cells.F12],
      ["Cobalt", "Cobalt", "Cobalt", "Copper"],
    );

    const caseSensitive = await detail(app.baseUrl, EVO_CASE_SENSITIVE_WORKBOOK_ID);
    const caseSheet = caseSensitive.body.workbook.worksheets[0];
    assert.equal(caseSheet.id, EVO_CASE_SENSITIVE_WORKSHEET_ID);
    assert.equal(caseSheet.name, "Narrative");
    assert.deepEqual([caseSheet.cells.G3, caseSheet.cells.G4, caseSheet.cells.G5], ["Cobalt", "cobalt", "Cobalt-7"]);
  } finally {
    await app.stop();
  }
});

test("replaces an explicit list of cells in one write and keeps it across a restart", async () => {
  const app = await startApp();
  try {
    const updated = await replace(app.baseUrl, EVO_REPLACE_ALL_WORKBOOK_ID, EVO_REPLACE_ALL_WORKSHEET_ID, [
      { coordinate: "F3", value: "Indigo" },
      { coordinate: "F6", value: "Indigo" },
      { coordinate: "F9", value: "Indigo" },
    ]);
    assert.equal(updated.status, 200);
    const cells = updated.body.workbook.worksheets[0].cells;
    assert.equal(cells.F3, "Indigo");
    assert.equal(cells.F6, "Indigo");
    assert.equal(cells.F9, "Indigo");
    // A cell that is not part of the payload keeps its value.
    assert.equal(cells.F12, "Copper");

    const restarted = await app.restart();
    try {
      const afterRestart = await detail(restarted.baseUrl, EVO_REPLACE_ALL_WORKBOOK_ID);
      const persisted = afterRestart.body.workbook.worksheets[0].cells;
      assert.equal(persisted.F3, "Indigo");
      assert.equal(persisted.F6, "Indigo");
      assert.equal(persisted.F9, "Indigo");
      assert.equal(persisted.F12, "Copper");
    } finally {
      await restarted.stop();
    }
  } finally {
    await app.stop();
  }
});

test("matches one casing only, so the other casing and the longer text stay", async () => {
  const app = await startApp();
  try {
    await replace(app.baseUrl, EVO_CASE_SENSITIVE_WORKBOOK_ID, EVO_CASE_SENSITIVE_WORKSHEET_ID, [
      { coordinate: "G3", value: "Azure" },
    ]);
    const stored = await detail(app.baseUrl, EVO_CASE_SENSITIVE_WORKBOOK_ID);
    const cells = stored.body.workbook.worksheets[0].cells;
    assert.equal(cells.G3, "Azure");
    assert.equal(cells.G4, "cobalt");
    assert.equal(cells.G5, "Cobalt-7");
  } finally {
    await app.stop();
  }
});

test("rejects a malformed replacement payload and leaves every cell as it was", async () => {
  const app = await startApp();
  try {
    for (const updates of [
      [],
      "not-an-array",
      [{ coordinate: "F3", value: 3 }],
      [{ value: "Indigo" }],
    ]) {
      const rejected = await replace(app.baseUrl, EVO_REPLACE_ALL_WORKBOOK_ID, EVO_REPLACE_ALL_WORKSHEET_ID, updates);
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error, INVALID_CELL_UPDATE_MESSAGE);
    }
    // A coordinate that is not an A1 reference is reported like every other
    // cell write of the API.
    const badCoordinate = await replace(app.baseUrl, EVO_REPLACE_ALL_WORKBOOK_ID, EVO_REPLACE_ALL_WORKSHEET_ID, [
      { coordinate: "nope", value: "Indigo" },
    ]);
    assert.equal(badCoordinate.status, 400);
    assert.equal(badCoordinate.body.error, "Unknown cell reference");
    const kept = await detail(app.baseUrl, EVO_REPLACE_ALL_WORKBOOK_ID);
    assert.deepEqual(
      [kept.body.workbook.worksheets[0].cells.F3, kept.body.workbook.worksheets[0].cells.F12],
      ["Cobalt", "Copper"],
    );

    const unknownSheet = await replace(app.baseUrl, EVO_REPLACE_ALL_WORKBOOK_ID, "no-such-worksheet", [
      { coordinate: "F3", value: "Indigo" },
    ]);
    assert.equal(unknownSheet.status, 400);
    const unknownWorkbook = await replace(app.baseUrl, "no-such-workbook", EVO_REPLACE_ALL_WORKSHEET_ID, [
      { coordinate: "F3", value: "Indigo" },
    ]);
    assert.equal(unknownWorkbook.status, 404);
  } finally {
    await app.stop();
  }
});

test("a replacement that breaks a validation rule rejects the whole write", async () => {
  const legacy = createSeedState();
  const workbook = legacy.workbooks.find((candidate) => candidate.id === EVO_REPLACE_ALL_WORKBOOK_ID);
  workbook.worksheets[0].validationRules = [
    { range: "F12", type: "dropdown", values: ["Cobalt", "Copper"], errorMessage: "Choose a known metal" },
  ];

  const app = await startApp({ state: legacy });
  try {
    const rejected = await replace(app.baseUrl, EVO_REPLACE_ALL_WORKBOOK_ID, EVO_REPLACE_ALL_WORKSHEET_ID, [
      { coordinate: "F3", value: "Indigo" },
      { coordinate: "F12", value: "Indigo" },
    ]);
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Choose a known metal");
    const kept = await detail(app.baseUrl, EVO_REPLACE_ALL_WORKBOOK_ID);
    assert.equal(kept.body.workbook.worksheets[0].cells.F3, "Cobalt");
    assert.equal(kept.body.workbook.worksheets[0].cells.F12, "Copper");
  } finally {
    await app.stop();
  }
});

test("upgrades a store of the previous round with the find-and-replace workbooks only once", async () => {
  const legacy = createSeedState();
  legacy.workbooks = legacy.workbooks.filter(
    (workbook) =>
      workbook.id !== EVO_FIND_NEXT_WORKBOOK_ID &&
      workbook.id !== EVO_REPLACE_ALL_WORKBOOK_ID &&
      workbook.id !== EVO_CASE_SENSITIVE_WORKBOOK_ID,
  );

  const app = await startApp({ state: legacy });
  try {
    const first = await json(app.baseUrl, "/api/workbooks");
    const ids = first.body.workbooks.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length, "upgrade must not duplicate workbooks");
    assert.ok(ids.includes(EVO_FIND_NEXT_WORKBOOK_ID));
    assert.ok(ids.includes(EVO_REPLACE_ALL_WORKBOOK_ID));
    assert.ok(ids.includes(EVO_CASE_SENSITIVE_WORKBOOK_ID));

    const findSheet = await detail(app.baseUrl, EVO_FIND_NEXT_WORKBOOK_ID);
    assert.equal(findSheet.body.workbook.worksheets[0].cells.E7, "Cobalt");

    const restarted = await app.restart();
    try {
      const second = await json(restarted.baseUrl, "/api/workbooks");
      const secondIds = second.body.workbooks.map((entry) => entry.id);
      assert.equal(new Set(secondIds).size, secondIds.length);
      assert.equal(secondIds.length, first.body.workbooks.length);
    } finally {
      await restarted.stop();
    }
  } finally {
    await app.stop();
  }
});

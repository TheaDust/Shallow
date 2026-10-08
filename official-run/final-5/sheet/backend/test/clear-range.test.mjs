import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { createSeedState } from "../src/store/workbooks.mjs";

const CLEAR_TEXT_ID = "EVO-M03-CLEAR-TEXT";
const CLEAR_FORMULA_ID = "EVO-M03-CLEAR-FORMULA";
const CLEAR_RANGE_ID = "EVO-M03-CLEAR-RANGE";

async function startApp(prepare) {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-clear-"));
  if (prepare) await prepare(dataDir);
  const server = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    dataDir,
    baseUrl,
    async stop() {
      await new Promise((done) => server.close(done));
    },
    async restart() {
      await new Promise((done) => server.close(done));
      const restarted = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
      await new Promise((done) => restarted.listen(0, "127.0.0.1", done));
      return {
        baseUrl: `http://127.0.0.1:${restarted.address().port}`,
        stop: () => new Promise((done) => restarted.close(done)),
      };
    },
  };
}

async function json(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

function post(body) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function getWorkbook(baseUrl, id) {
  return (await json(baseUrl, `/api/workbooks/${id}`)).body.workbook;
}

function batchUrl(workbookId, worksheetId) {
  return `/api/workbooks/${workbookId}/worksheets/${worksheetId}/cells/batch`;
}

test("seeds the three EVO clear workbooks with their worksheets and values", async () => {
  const app = await startApp();
  try {
    const clearText = await getWorkbook(app.baseUrl, CLEAR_TEXT_ID);
    assert.equal(clearText.name, CLEAR_TEXT_ID);
    assert.equal(clearText.worksheets[0].name, "Staging");
    assert.equal(clearText.activeWorksheetId, `${CLEAR_TEXT_ID}--Staging`);
    assert.equal(clearText.worksheets[0].cells.H4, "obsolete tag");

    const formula = await getWorkbook(app.baseUrl, CLEAR_FORMULA_ID);
    assert.equal(formula.worksheets[0].name, "Calculations");
    assert.equal(formula.activeWorksheetId, `${CLEAR_FORMULA_ID}--Calculations`);
    assert.deepEqual(formula.worksheets[0].cells, { B7: "13", C7: "=B7*5", D7: "=C7+2" });

    const range = await getWorkbook(app.baseUrl, CLEAR_RANGE_ID);
    assert.equal(range.worksheets[0].name, "Matrix");
    assert.equal(range.activeWorksheetId, `${CLEAR_RANGE_ID}--Matrix`);
    assert.deepEqual(range.worksheets[0].cells, { H4: "Amber/Delta", I4: "Kite/Orchid" });
  } finally {
    await app.stop();
  }
});

test("a batch of empty values clears the rectangle atomically and persists across restarts", async () => {
  const app = await startApp();
  try {
    const url = batchUrl(CLEAR_RANGE_ID, `${CLEAR_RANGE_ID}--Matrix`);
    const cleared = await json(app.baseUrl, url, post({ start: "H4", rows: [["", ""], ["", ""]] }));
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.body.workbook.worksheets[0].cells, {});

    const afterClear = await getWorkbook(app.baseUrl, CLEAR_RANGE_ID);
    assert.deepEqual(afterClear.worksheets[0].cells, {});

    const restarted = await app.restart();
    try {
      const reloaded = await getWorkbook(restarted.baseUrl, CLEAR_RANGE_ID);
      assert.deepEqual(reloaded.worksheets[0].cells, {});
    } finally {
      await restarted.stop();
    }
  } finally {
    await app.stop();
  }
});

test("clearing a formula cell removes the original formula and keeps its dependents' formulas", async () => {
  const app = await startApp();
  try {
    const url = batchUrl(CLEAR_FORMULA_ID, `${CLEAR_FORMULA_ID}--Calculations`);
    const cleared = await json(app.baseUrl, url, post({ start: "C7", rows: [[""]] }));
    assert.equal(cleared.status, 200);
    const cells = cleared.body.workbook.worksheets[0].cells;
    assert.equal(cells.C7, undefined);
    assert.equal(cells.B7, "13");
    assert.equal(cells.D7, "=C7+2");
  } finally {
    await app.stop();
  }
});

test("upgrades an existing data directory by adding the missing EVO clear workbooks without dropping records", async () => {
  const q3 = createSeedState().workbooks.find((workbook) => workbook.id === "wb-q3-sales");
  const userWorkbook = {
    id: "user-wb-clear",
    name: "My Staging",
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
    activeWorksheetId: "user-ws-clear",
    worksheets: [
      { id: "user-ws-clear", name: "Sheet1", selection: { anchor: "A1", focus: "A1" }, cells: { H4: "keep" } },
    ],
  };
  // An older data directory that predates this round's pre-provisioned workbooks.
  const app = await startApp(async (dir) => {
    await writeFile(
      join(dir, "workbooks.json"),
      JSON.stringify({ workbooks: [q3, userWorkbook] }, null, 2),
      "utf8",
    );
  });
  try {
    for (const id of [CLEAR_TEXT_ID, CLEAR_FORMULA_ID, CLEAR_RANGE_ID]) {
      assert.equal((await getWorkbook(app.baseUrl, id)).name, id);
    }
    const kept = await getWorkbook(app.baseUrl, "user-wb-clear");
    assert.equal(kept.name, "My Staging");
    assert.equal(kept.worksheets[0].cells.H4, "keep");

    const restarted = await app.restart();
    try {
      assert.equal((await getWorkbook(restarted.baseUrl, "user-wb-clear")).worksheets[0].cells.H4, "keep");
      const stored = JSON.parse(await readFile(join(app.dataDir, "workbooks.json"), "utf8"));
      const ids = stored.workbooks.map((workbook) => workbook.id);
      for (const id of [CLEAR_TEXT_ID, CLEAR_FORMULA_ID, CLEAR_RANGE_ID]) {
        assert.equal(ids.filter((candidate) => candidate === id).length, 1, `${id} seeded once`);
      }
    } finally {
      await restarted.stop();
    }
  } finally {
    await app.stop();
  }
});

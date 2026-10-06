import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";

/** Pre-provisioned workbook/worksheet identity of each clear scenario. */
const CLEAR_TEXT = { workbook: "wb-evo-m03-clear-text", worksheet: "ws-evo-m03-clear-text-staging" };
const CLEAR_FORMULA = { workbook: "wb-evo-m03-clear-formula", worksheet: "ws-evo-m03-clear-formula-calculations" };
const CLEAR_RANGE = { workbook: "wb-evo-m03-clear-range", worksheet: "ws-evo-m03-clear-range-matrix" };

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-clear-"));
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
      const url = `http://127.0.0.1:${restarted.address().port}`;
      return {
        baseUrl: url,
        client: { get: async (id) => (await json(url, `/api/workbooks/${id}`)).body.workbook },
        stop: () => new Promise((done) => restarted.close(done)),
      };
    },
  };
}

async function json(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

function send(body) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/** Bulk cell endpoint used by the grid's Delete key. */
function batchUrl({ workbook, worksheet }) {
  return `/api/workbooks/${workbook}/worksheets/${worksheet}/cells/batch`;
}

async function getWorkbook(baseUrl, id) {
  return (await json(baseUrl, `/api/workbooks/${id}`)).body.workbook;
}

test("pre-provisions one EVO workbook per cell-clear scenario with its active worksheet", async () => {
  const app = await startApp();
  try {
    const text = await getWorkbook(app.baseUrl, CLEAR_TEXT.workbook);
    assert.equal(text.name, "EVO-M03-CLEAR-TEXT");
    assert.equal(text.activeWorksheetId, CLEAR_TEXT.worksheet);
    assert.equal(text.worksheets[0].name, "Staging");
    assert.equal(text.worksheets[0].cells.H4, "obsolete tag");

    const formula = await getWorkbook(app.baseUrl, CLEAR_FORMULA.workbook);
    assert.equal(formula.name, "EVO-M03-CLEAR-FORMULA");
    assert.equal(formula.activeWorksheetId, CLEAR_FORMULA.worksheet);
    assert.equal(formula.worksheets[0].name, "Calculations");
    assert.deepEqual(formula.worksheets[0].cells, { B7: "13", C7: "=B7*5", D7: "=C7+2" });

    const range = await getWorkbook(app.baseUrl, CLEAR_RANGE.workbook);
    assert.equal(range.name, "EVO-M03-CLEAR-RANGE");
    assert.equal(range.activeWorksheetId, CLEAR_RANGE.worksheet);
    assert.equal(range.worksheets[0].name, "Matrix");
    assert.deepEqual(range.worksheets[0].cells, { H4: "Amber", I4: "Delta", H5: "Kite", I5: "Orchid" });
  } finally {
    await app.stop();
  }
});

test("clearing a text cell empties it and stays empty after a restart", async () => {
  const app = await startApp();
  try {
    // The visitor selects the cell first: the clear must not move the selection.
    const selected = await json(
      app.baseUrl,
      `/api/workbooks/${CLEAR_TEXT.workbook}/worksheets/${CLEAR_TEXT.worksheet}/selection`,
      { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ anchor: "H4", focus: "H4" }) },
    );
    assert.equal(selected.status, 200);

    const cleared = await json(app.baseUrl, batchUrl(CLEAR_TEXT), send({ start: "H4", rows: [[""]] }));
    assert.equal(cleared.status, 200);
    const cells = cleared.body.workbook.worksheets[0].cells;
    assert.equal(cells.H4, undefined);
    assert.deepEqual(cells, {});
    assert.deepEqual(cleared.body.workbook.worksheets[0].selection, { anchor: "H4", focus: "H4" });

    const restarted = await app.restart();
    try {
      const workbook = await restarted.client.get(CLEAR_TEXT.workbook);
      assert.deepEqual(workbook.worksheets[0].cells, {});
      // The cleared cell stays selected, so a reload shows the same cell.
      assert.deepEqual(workbook.worksheets[0].selection, { anchor: "H4", focus: "H4" });
    } finally {
      await restarted.stop();
    }
  } finally {
    await app.stop();
  }
});

test("clearing a formula cell drops its expression and keeps the dependent formulas", async () => {
  const app = await startApp();
  try {
    const cleared = await json(app.baseUrl, batchUrl(CLEAR_FORMULA), send({ start: "C7", rows: [[""]] }));
    assert.equal(cleared.status, 200);
    const cells = cleared.body.workbook.worksheets[0].cells;
    assert.equal(cells.C7, undefined);
    // The source value and both dependent expressions stay stored, so the grid
    // recalculates `D7` from an empty `C7` (blank counts as zero).
    assert.equal(cells.B7, "13");
    assert.equal(cells.D7, "=C7+2");

    const restarted = await app.restart();
    try {
      const workbook = await restarted.client.get(CLEAR_FORMULA.workbook);
      assert.deepEqual(workbook.worksheets[0].cells, { B7: "13", D7: "=C7+2" });
    } finally {
      await restarted.stop();
    }
  } finally {
    await app.stop();
  }
});

test("clearing a rectangular range empties every cell of the rectangle in one write", async () => {
  const app = await startApp();
  try {
    const other = await getWorkbook(app.baseUrl, CLEAR_TEXT.workbook);
    assert.equal(other.worksheets[0].cells.H4, "obsolete tag");

    const cleared = await json(
      app.baseUrl,
      batchUrl(CLEAR_RANGE),
      send({ start: "H4", rows: [["", ""], ["", ""]] }),
    );
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.body.workbook.worksheets[0].cells, {});
    // Another scenario's workbook keeps its own cell.
    const untouched = await getWorkbook(app.baseUrl, CLEAR_TEXT.workbook);
    assert.deepEqual(untouched.worksheets[0].cells, { H4: "obsolete tag" });

    const restarted = await app.restart();
    try {
      const workbook = await restarted.client.get(CLEAR_RANGE.workbook);
      assert.deepEqual(workbook.worksheets[0].cells, {});
    } finally {
      await restarted.stop();
    }
  } finally {
    await app.stop();
  }
});

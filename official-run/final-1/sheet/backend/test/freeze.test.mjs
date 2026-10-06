import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";

/** Pre-provisioned workbook/worksheet identity of each freeze scenario. */
const FREEZE_ROW = { workbook: "wb-evo-n01-freeze-row", worksheet: "ws-evo-n01-freeze-row-scroll-ledger" };
const FREEZE_COLUMN = { workbook: "wb-evo-n01-freeze-column", worksheet: "ws-evo-n01-freeze-column-scroll-ledger" };
const FREEZE_BOTH = { workbook: "wb-evo-n01-freeze-both", worksheet: "ws-evo-n01-freeze-both-scroll-ledger" };

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-freeze-"));
  const server = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    dataDir,
    baseUrl,
    async stop() {
      await new Promise((done) => server.close(done));
    },
    /** Reopens the same data directory, as a browser refresh does. */
    async restart() {
      await new Promise((done) => server.close(done));
      const restarted = createServer(createRequestHandler({ dataDir, staticRoot: dataDir }));
      await new Promise((done) => restarted.listen(0, "127.0.0.1", done));
      const url = `http://127.0.0.1:${restarted.address().port}`;
      return {
        baseUrl: url,
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
  return { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function freezeUrl({ workbook, worksheet }) {
  return `/api/workbooks/${workbook}/worksheets/${worksheet}/freeze`;
}

async function getWorkbook(baseUrl, id) {
  return (await json(baseUrl, `/api/workbooks/${id}`)).body.workbook;
}

test("pre-provisions one ScrollLedger workbook per freeze scenario with headers and 40 data rows", async () => {
  const app = await startApp();
  try {
    for (const [scenario, name] of [
      [FREEZE_ROW, "EVO-N01-FREEZE-ROW"],
      [FREEZE_COLUMN, "EVO-N01-FREEZE-COLUMN"],
      [FREEZE_BOTH, "EVO-N01-FREEZE-BOTH"],
    ]) {
      const workbook = await getWorkbook(app.baseUrl, scenario.workbook);
      assert.equal(workbook.name, name);
      assert.equal(workbook.activeWorksheetId, scenario.worksheet);
      const worksheet = workbook.worksheets[0];
      assert.equal(worksheet.name, "ScrollLedger");
      // Headers sit in row 1 across columns A..L and data runs through row 40.
      assert.equal(worksheet.cells.A1, "Entry");
      assert.equal(worksheet.cells.L1, "Updated");
      assert.equal(worksheet.cells.A2, "Entry 1");
      assert.equal(worksheet.cells.A40, "Entry 39");
      assert.equal(worksheet.cells.L40, "2026-10-03");
      // No scenario starts frozen.
      assert.equal(worksheet.freeze, undefined);
    }
  } finally {
    await app.stop();
  }
});

test("freezing rows and columns stores the counts and restores them after a restart", async () => {
  const app = await startApp();
  try {
    const freezed = await json(app.baseUrl, freezeUrl(FREEZE_BOTH), send({ rows: 3, columns: 2 }));
    assert.equal(freezed.status, 200);
    assert.deepEqual(freezed.body.workbook.worksheets[0].freeze, { rows: 3, columns: 2 });
    // Freezing is view state: the cells are untouched.
    assert.equal(freezed.body.workbook.worksheets[0].cells.A40, "Entry 39");

    const restarted = await app.restart();
    try {
      const workbook = await getWorkbook(restarted.baseUrl, FREEZE_BOTH.workbook);
      assert.deepEqual(workbook.worksheets[0].freeze, { rows: 3, columns: 2 });
    } finally {
      await restarted.stop();
    }
  } finally {
    await app.stop();
  }
});

test("freezing only rows or only columns keeps the other count and can be cleared again", async () => {
  const app = await startApp();
  try {
    const rows = await json(app.baseUrl, freezeUrl(FREEZE_ROW), send({ rows: 1, columns: 0 }));
    assert.equal(rows.status, 200);
    assert.deepEqual(rows.body.workbook.worksheets[0].freeze, { rows: 1, columns: 0 });

    const columns = await json(app.baseUrl, freezeUrl(FREEZE_COLUMN), send({ rows: 0, columns: 1 }));
    assert.equal(columns.status, 200);
    assert.deepEqual(columns.body.workbook.worksheets[0].freeze, { rows: 0, columns: 1 });

    const cleared = await json(app.baseUrl, freezeUrl(FREEZE_ROW), send({ rows: 0, columns: 0 }));
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.workbook.worksheets[0].freeze, undefined);
    // Every other scenario keeps its own state.
    const other = await getWorkbook(app.baseUrl, FREEZE_COLUMN.workbook);
    assert.deepEqual(other.worksheets[0].freeze, { rows: 0, columns: 1 });
  } finally {
    await app.stop();
  }
});

test("a malformed freeze request is rejected without changing the stored state", async () => {
  const app = await startApp();
  try {
    await json(app.baseUrl, freezeUrl(FREEZE_ROW), send({ rows: 2, columns: 1 }));

    for (const payload of [
      { rows: -1, columns: 0 },
      { rows: 1, columns: 1.5 },
      { rows: "1", columns: 0 },
      { columns: 1 },
      {},
    ]) {
      const rejected = await json(app.baseUrl, freezeUrl(FREEZE_ROW), send(payload));
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error, "Invalid freeze panes");
    }

    const unchanged = await getWorkbook(app.baseUrl, FREEZE_ROW.workbook);
    assert.deepEqual(unchanged.worksheets[0].freeze, { rows: 2, columns: 1 });

    const missing = await json(app.baseUrl, freezeUrl({ workbook: "wb-missing", worksheet: "ws-missing" }), send({ rows: 1, columns: 0 }));
    assert.equal(missing.status, 404);
  } finally {
    await app.stop();
  }
});

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import {
  EVO_FREEZE_BOTH_WORKBOOK_ID,
  EVO_FREEZE_BOTH_WORKSHEET_ID,
  EVO_FREEZE_COLUMN_WORKBOOK_ID,
  EVO_FREEZE_COLUMN_WORKSHEET_ID,
  EVO_FREEZE_ROW_WORKBOOK_ID,
  EVO_FREEZE_ROW_WORKSHEET_ID,
  INVALID_FREEZE_MESSAGE,
  createSeedState,
} from "../src/store/workbooks.mjs";

async function startApp({ state } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-freeze-"));
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

function put(baseUrl, path, payload) {
  return json(baseUrl, path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function detail(baseUrl, workbookId) {
  return json(baseUrl, `/api/workbooks/${workbookId}`);
}

function freezeUrl(workbookId, worksheetId) {
  return `/api/workbooks/${workbookId}/worksheets/${worksheetId}/freeze`;
}

test("pre-provisions the freeze workbooks with a ScrollLedger sheet of the declared extent", async () => {
  const app = await startApp();
  try {
    const row = await detail(app.baseUrl, EVO_FREEZE_ROW_WORKBOOK_ID);
    assert.equal(row.status, 200);
    assert.equal(row.body.workbook.name, EVO_FREEZE_ROW_WORKBOOK_ID);
    const rowSheet = row.body.workbook.worksheets[0];
    assert.equal(rowSheet.name, "ScrollLedger");
    assert.equal(row.body.workbook.activeWorksheetId, EVO_FREEZE_ROW_WORKSHEET_ID);
    assert.equal(rowSheet.cells.A1, "Entry");
    assert.equal(rowSheet.cells.B1, "Amount");
    assert.ok(rowSheet.cells.A40, "the row scenario has data through row 40");
    assert.equal(rowSheet.frozen, undefined);

    const column = await detail(app.baseUrl, EVO_FREEZE_COLUMN_WORKBOOK_ID);
    const columnSheet = column.body.workbook.worksheets[0];
    assert.equal(columnSheet.name, "ScrollLedger");
    assert.equal(columnSheet.cells.A1, "Entry");
    assert.equal(columnSheet.cells.L1, "Notes");
    assert.ok(columnSheet.cells.L8, "the column scenario has data through column L");

    const both = await detail(app.baseUrl, EVO_FREEZE_BOTH_WORKBOOK_ID);
    const bothSheet = both.body.workbook.worksheets[0];
    assert.equal(bothSheet.id, EVO_FREEZE_BOTH_WORKSHEET_ID);
    assert.equal(bothSheet.name, "ScrollLedger");
    assert.equal(bothSheet.cells.L1, "Notes");
    assert.ok(bothSheet.cells.L40, "the both scenario has data through row 40 and column L");
  } finally {
    await app.stop();
  }
});

test("stores the frozen pane counts of one worksheet and keeps them across a restart", async () => {
  const app = await startApp();
  try {
    const frozen = await put(app.baseUrl, freezeUrl(EVO_FREEZE_ROW_WORKBOOK_ID, EVO_FREEZE_ROW_WORKSHEET_ID), {
      rows: 1,
      columns: 0,
    });
    assert.equal(frozen.status, 200);
    assert.deepEqual(frozen.body.workbook.worksheets[0].frozen, { rows: 1, columns: 0 });
    // Freezing is view state: no cell changes.
    assert.equal(frozen.body.workbook.worksheets[0].cells.A1, "Entry");

    const both = await put(app.baseUrl, freezeUrl(EVO_FREEZE_BOTH_WORKBOOK_ID, EVO_FREEZE_BOTH_WORKSHEET_ID), {
      rows: 3,
      columns: 2,
    });
    assert.equal(both.status, 200);
    assert.deepEqual(both.body.workbook.worksheets[0].frozen, { rows: 3, columns: 2 });

    const restarted = await app.restart();
    try {
      const afterRow = await detail(restarted.baseUrl, EVO_FREEZE_ROW_WORKBOOK_ID);
      assert.deepEqual(afterRow.body.workbook.worksheets[0].frozen, { rows: 1, columns: 0 });
      const afterBoth = await detail(restarted.baseUrl, EVO_FREEZE_BOTH_WORKBOOK_ID);
      assert.deepEqual(afterBoth.body.workbook.worksheets[0].frozen, { rows: 3, columns: 2 });
      // The other freeze workbooks are untouched.
      const untouched = await detail(restarted.baseUrl, EVO_FREEZE_COLUMN_WORKBOOK_ID);
      assert.equal(untouched.body.workbook.worksheets[0].frozen, undefined);
    } finally {
      await restarted.stop();
    }
  } finally {
    await app.stop();
  }
});

test("unfreezing drops the stored panes and a second freeze replaces them", async () => {
  const app = await startApp();
  try {
    await put(app.baseUrl, freezeUrl(EVO_FREEZE_COLUMN_WORKBOOK_ID, EVO_FREEZE_COLUMN_WORKSHEET_ID), {
      rows: 0,
      columns: 1,
    });
    const replaced = await put(app.baseUrl, freezeUrl(EVO_FREEZE_COLUMN_WORKBOOK_ID, EVO_FREEZE_COLUMN_WORKSHEET_ID), {
      rows: 2,
      columns: 4,
    });
    assert.deepEqual(replaced.body.workbook.worksheets[0].frozen, { rows: 2, columns: 4 });

    const cleared = await put(app.baseUrl, freezeUrl(EVO_FREEZE_COLUMN_WORKBOOK_ID, EVO_FREEZE_COLUMN_WORKSHEET_ID), {
      rows: 0,
      columns: 0,
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.workbook.worksheets[0].frozen, undefined);
  } finally {
    await app.stop();
  }
});

test("rejects malformed frozen pane counts, an unknown worksheet and an unknown workbook", async () => {
  const app = await startApp();
  try {
    for (const payload of [
      { rows: -1, columns: 0 },
      { rows: 1.5, columns: 0 },
      { rows: "1", columns: 0 },
      { rows: 1 },
      { rows: 0, columns: null },
    ]) {
      const rejected = await put(app.baseUrl, freezeUrl(EVO_FREEZE_ROW_WORKBOOK_ID, EVO_FREEZE_ROW_WORKSHEET_ID), payload);
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error, INVALID_FREEZE_MESSAGE);
    }
    const kept = await detail(app.baseUrl, EVO_FREEZE_ROW_WORKBOOK_ID);
    assert.equal(kept.body.workbook.worksheets[0].frozen, undefined);

    const unknownSheet = await put(app.baseUrl, freezeUrl(EVO_FREEZE_ROW_WORKBOOK_ID, "no-such-worksheet"), {
      rows: 1,
      columns: 1,
    });
    assert.equal(unknownSheet.status, 400);
    const unknownWorkbook = await put(app.baseUrl, freezeUrl("no-such-workbook", EVO_FREEZE_ROW_WORKSHEET_ID), {
      rows: 1,
      columns: 1,
    });
    assert.equal(unknownWorkbook.status, 404);
  } finally {
    await app.stop();
  }
});

test("upgrades a store of the previous round with the freeze workbooks only once", async () => {
  // A store written before this round: the baseline workbook with user values
  // and the earlier rounds' pre-provisioned workbooks, but none of the N01 ones.
  const legacy = createSeedState();
  legacy.workbooks = legacy.workbooks.filter(
    (workbook) =>
      workbook.id !== EVO_FREEZE_ROW_WORKBOOK_ID &&
      workbook.id !== EVO_FREEZE_COLUMN_WORKBOOK_ID &&
      workbook.id !== EVO_FREEZE_BOTH_WORKBOOK_ID,
  );
  const baseline = legacy.workbooks.find((workbook) => workbook.id === "wb-q3-sales");
  baseline.name = "My Ledger";
  baseline.worksheets[0].cells.A1 = "Region edited";
  legacy.workbooks.push({
    id: "user-workbook-freeze",
    name: "My own workbook",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:05:00.000Z",
    activeWorksheetId: "user-worksheet-freeze",
    worksheets: [
      {
        id: "user-worksheet-freeze",
        name: "Sheet1",
        selection: { anchor: "A1", focus: "A1" },
        cells: { C2: "keep me" },
      },
    ],
  });

  const app = await startApp({ state: legacy });
  try {
    const first = await json(app.baseUrl, "/api/workbooks");
    const ids = first.body.workbooks.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length, "upgrade must not duplicate workbooks");
    for (const expected of [
      EVO_FREEZE_ROW_WORKBOOK_ID,
      EVO_FREEZE_COLUMN_WORKBOOK_ID,
      EVO_FREEZE_BOTH_WORKBOOK_ID,
    ]) {
      assert.ok(ids.includes(expected), `upgrade must add ${expected}`);
    }
    assert.ok(ids.includes("user-workbook-freeze"));
    const renamed = first.body.workbooks.find((entry) => entry.id === "wb-q3-sales");
    assert.equal(renamed.name, "My Ledger");

    const upgraded = await detail(app.baseUrl, EVO_FREEZE_ROW_WORKBOOK_ID);
    assert.equal(upgraded.body.workbook.worksheets[0].name, "ScrollLedger");
    assert.equal(upgraded.body.workbook.worksheets[0].cells.B1, "Amount");

    const frozen = await put(app.baseUrl, freezeUrl(EVO_FREEZE_ROW_WORKBOOK_ID, EVO_FREEZE_ROW_WORKSHEET_ID), {
      rows: 1,
      columns: 0,
    });
    assert.deepEqual(frozen.body.workbook.worksheets[0].frozen, { rows: 1, columns: 0 });

    const restarted = await app.restart();
    try {
      const second = await json(restarted.baseUrl, "/api/workbooks");
      const secondIds = second.body.workbooks.map((entry) => entry.id);
      assert.equal(new Set(secondIds).size, secondIds.length);
      assert.equal(secondIds.length, first.body.workbooks.length);
      const persistedBaseline = await detail(restarted.baseUrl, "wb-q3-sales");
      assert.equal(persistedBaseline.body.workbook.name, "My Ledger");
      assert.equal(persistedBaseline.body.workbook.worksheets[0].cells.A1, "Region edited");
      const persistedUser = await detail(restarted.baseUrl, "user-workbook-freeze");
      assert.equal(persistedUser.body.workbook.worksheets[0].cells.C2, "keep me");
      const persistedFreeze = await detail(restarted.baseUrl, EVO_FREEZE_ROW_WORKBOOK_ID);
      assert.deepEqual(persistedFreeze.body.workbook.worksheets[0].frozen, { rows: 1, columns: 0 });
    } finally {
      await restarted.stop();
    }

    const onDisk = JSON.parse(await readFile(join(app.dataDir, "workbooks.json"), "utf8"));
    for (const expected of [
      EVO_FREEZE_ROW_WORKBOOK_ID,
      EVO_FREEZE_COLUMN_WORKBOOK_ID,
      EVO_FREEZE_BOTH_WORKBOOK_ID,
    ]) {
      assert.equal(onDisk.workbooks.filter((workbook) => workbook.id === expected).length, 1);
    }
  } finally {
    await app.stop();
  }
});

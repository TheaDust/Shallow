import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/app.mjs";
import { SEED_WORKBOOK_ID, createSeedState } from "../src/store/workbooks.mjs";

const ROW_ID = "EVO-N01-FREEZE-ROW";
const COLUMN_ID = "EVO-N01-FREEZE-COLUMN";
const BOTH_ID = "EVO-N01-FREEZE-BOTH";
const FIND_NEXT_ID = "EVO-N02-FIND-NEXT";
const REPLACE_ALL_ID = "EVO-N02-REPLACE-ALL";
const CASE_ID = "EVO-N02-CASE-SENSITIVE";
const NEW_SEED_IDS = [ROW_ID, COLUMN_ID, BOTH_ID, FIND_NEXT_ID, REPLACE_ALL_ID, CASE_ID];
const INVALID_FREEZE_MESSAGE = "Invalid freeze panes request";

async function startApp(dataDir) {
  if (!dataDir) dataDir = await mkdtemp(join(tmpdir(), "shallowcode-freeze-"));
  const staticRoot = await mkdtemp(join(tmpdir(), "shallowcode-freeze-dist-"));
  await writeFile(join(staticRoot, "index.html"), "<!doctype html>", "utf8");
  await mkdir(join(staticRoot, "assets"), { recursive: true });
  let server;
  const app = {
    dataDir,
    baseUrl: "",
    async listen() {
      server = createServer(createRequestHandler({ dataDir, staticRoot }));
      await new Promise((done) => server.listen(0, "127.0.0.1", done));
      app.baseUrl = `http://127.0.0.1:${server.address().port}`;
      return app.baseUrl;
    },
    async stop() {
      if (!server) return;
      const closing = server;
      server = undefined;
      await new Promise((done) => closing.close(done));
    },
    async restart() {
      await app.stop();
      return app.listen();
    },
  };
  await app.listen();
  return app;
}

async function json(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

function send(baseUrl, method, path, payload) {
  return json(baseUrl, path, {
    method,
    headers: { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

function freezeUrl(workbookId, worksheetName) {
  return `/api/workbooks/${workbookId}/worksheets/${workbookId}--${worksheetName}/freeze`;
}

async function getWorkbook(baseUrl, id) {
  return (await json(baseUrl, `/api/workbooks/${id}`)).body.workbook;
}

function worksheetOf(workbook, name) {
  return workbook.worksheets.find((worksheet) => worksheet.name === name);
}

test("pre-provisions the freeze worksheets with headers in row 1 and the ledger records", async () => {
  const app = await startApp();
  try {
    for (const id of [ROW_ID, COLUMN_ID, BOTH_ID]) {
      const workbook = await getWorkbook(app.baseUrl, id);
      assert.equal(workbook.name, id);
      const ledger = worksheetOf(workbook, "ScrollLedger");
      assert.ok(ledger, `${id} has the ScrollLedger worksheet`);
      assert.equal(ledger.cells.A1, "Entry");
      assert.equal(ledger.cells.B1, "Account");
      assert.equal(ledger.cells.L1, "Ref");
      // Records run through row 40 and across column L.
      assert.ok(ledger.cells.A40, "row 40 has data");
      assert.ok(ledger.cells.L40, "column L has data");
      assert.equal(ledger.selection.anchor, "A1");
      assert.equal(ledger.frozenRows, undefined);
      assert.equal(ledger.frozenColumns, undefined);
    }
  } finally {
    await app.stop();
  }
});

test("pre-provisions the find-and-replace narratives with the scenario values", async () => {
  const app = await startApp();
  try {
    const findNext = worksheetOf(await getWorkbook(app.baseUrl, FIND_NEXT_ID), "Narrative");
    assert.deepEqual(findNext.cells, { E4: "Cobalt", E7: "Cobalt", E11: "Cobalt" });

    const replaceAll = worksheetOf(await getWorkbook(app.baseUrl, REPLACE_ALL_ID), "Narrative");
    assert.deepEqual(replaceAll.cells, { F3: "Cobalt", F6: "Cobalt", F9: "Cobalt", F12: "Copper" });

    const caseSensitive = worksheetOf(await getWorkbook(app.baseUrl, CASE_ID), "Narrative");
    assert.deepEqual(caseSensitive.cells, { G3: "Cobalt", G4: "cobalt", G5: "Cobalt-7" });
  } finally {
    await app.stop();
  }
});

test("stores the frozen counts per worksheet and keeps them across a restart", async () => {
  const app = await startApp();
  try {
    const rowFreeze = await send(app.baseUrl, "PATCH", freezeUrl(ROW_ID, "ScrollLedger"), { rows: 1, columns: 0 });
    assert.equal(rowFreeze.status, 200);
    assert.equal(worksheetOf(rowFreeze.body.workbook, "ScrollLedger").frozenRows, 1);
    assert.equal(worksheetOf(rowFreeze.body.workbook, "ScrollLedger").frozenColumns, undefined);

    const columnFreeze = await send(app.baseUrl, "PATCH", freezeUrl(COLUMN_ID, "ScrollLedger"), {
      rows: 0,
      columns: 1,
    });
    assert.equal(columnFreeze.status, 200);
    assert.equal(worksheetOf(columnFreeze.body.workbook, "ScrollLedger").frozenColumns, 1);
    assert.equal(worksheetOf(columnFreeze.body.workbook, "ScrollLedger").frozenRows, undefined);

    const bothFreeze = await send(app.baseUrl, "PATCH", freezeUrl(BOTH_ID, "ScrollLedger"), { rows: 3, columns: 2 });
    assert.equal(bothFreeze.status, 200);
    const frozen = worksheetOf(bothFreeze.body.workbook, "ScrollLedger");
    assert.equal(frozen.frozenRows, 3);
    assert.equal(frozen.frozenColumns, 2);

    await app.restart();
    const reloadedRow = worksheetOf(await getWorkbook(app.baseUrl, ROW_ID), "ScrollLedger");
    assert.equal(reloadedRow.frozenRows, 1);
    // The frozen state of one workbook never reaches another one.
    assert.equal(worksheetOf(await getWorkbook(app.baseUrl, COLUMN_ID), "ScrollLedger").frozenRows, undefined);
    const reloadedBoth = worksheetOf(await getWorkbook(app.baseUrl, BOTH_ID), "ScrollLedger");
    assert.equal(reloadedBoth.frozenRows, 3);
    assert.equal(reloadedBoth.frozenColumns, 2);
  } finally {
    await app.stop();
  }
});

test("clears the stored counts when both axes are unfrozen and rejects invalid requests", async () => {
  const app = await startApp();
  try {
    await send(app.baseUrl, "PATCH", freezeUrl(BOTH_ID, "ScrollLedger"), { rows: 3, columns: 2 });
    const cleared = await send(app.baseUrl, "PATCH", freezeUrl(BOTH_ID, "ScrollLedger"), { rows: 0, columns: 0 });
    assert.equal(cleared.status, 200);
    const unfrozen = worksheetOf(cleared.body.workbook, "ScrollLedger");
    assert.equal(unfrozen.frozenRows, undefined);
    assert.equal(unfrozen.frozenColumns, undefined);

    for (const payload of [{ rows: -1, columns: 0 }, { rows: 1 }, { rows: 1.5, columns: 0 }, { rows: "1", columns: 0 }]) {
      const rejected = await send(app.baseUrl, "PATCH", freezeUrl(BOTH_ID, "ScrollLedger"), payload);
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error, INVALID_FREEZE_MESSAGE);
    }
    const stored = worksheetOf(await getWorkbook(app.baseUrl, BOTH_ID), "ScrollLedger");
    assert.equal(stored.frozenRows, undefined);
    assert.equal(stored.frozenColumns, undefined);

    const unknownWorksheet = await send(app.baseUrl, "PATCH", freezeUrl(BOTH_ID, "Missing"), { rows: 1, columns: 0 });
    assert.equal(unknownWorksheet.status, 400);
    const unknownWorkbook = await send(app.baseUrl, "PATCH", "/api/workbooks/missing/worksheets/x/freeze", {
      rows: 1,
      columns: 0,
    });
    assert.equal(unknownWorkbook.status, 404);
  } finally {
    await app.stop();
  }
});

test("upgrades an older store with the freeze and find-and-replace scenarios without dropping records", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-freeze-upgrade-"));
  const baseline = createSeedState().workbooks.find((workbook) => workbook.id === SEED_WORKBOOK_ID);
  const userWorkbook = {
    id: "user-wb-freeze",
    name: "My Ledger",
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
    activeWorksheetId: "user-ws-freeze",
    worksheets: [
      {
        id: "user-ws-freeze",
        name: "Ledger",
        selection: { anchor: "A1", focus: "A1" },
        cells: { A1: "keep" },
        frozenRows: 2,
      },
    ],
  };
  await writeFile(
    join(dataDir, "workbooks.json"),
    JSON.stringify({ workbooks: [baseline, userWorkbook] }, null, 2),
    "utf8",
  );

  const app = await startApp(dataDir);
  try {
    const listed = await json(app.baseUrl, "/api/workbooks");
    const ids = listed.body.workbooks.map((workbook) => workbook.id);
    for (const id of [...NEW_SEED_IDS, SEED_WORKBOOK_ID, "user-wb-freeze"]) {
      assert.ok(ids.includes(id), `${id} present after upgrade`);
    }
    const user = await getWorkbook(app.baseUrl, "user-wb-freeze");
    assert.equal(worksheetOf(user, "Ledger").cells.A1, "keep");
    assert.equal(worksheetOf(user, "Ledger").frozenRows, 2);

    // Restarting again neither duplicates a pre-provisioned workbook nor
    // rewrites the user's own record.
    await app.restart();
    const afterRestart = await json(app.baseUrl, "/api/workbooks");
    const restartedIds = afterRestart.body.workbooks.map((workbook) => workbook.id);
    assert.equal(restartedIds.length, ids.length);
    for (const id of NEW_SEED_IDS) {
      assert.equal(restartedIds.filter((candidate) => candidate === id).length, 1, `${id} appears once`);
    }
    assert.equal(worksheetOf(await getWorkbook(app.baseUrl, "user-wb-freeze"), "Ledger").cells.A1, "keep");
  } finally {
    await app.stop();
  }
});

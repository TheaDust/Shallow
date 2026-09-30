import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { SEED_WORKBOOK_ID, SEED_WORKSHEET_ID } from "../src/lib/seed.mjs";
import { createWorkbookRepository } from "../src/lib/workbook-store.mjs";

async function startTestServer() {
  const directory = await mkdtemp(join(tmpdir(), "shallowcode-editing-"));
  const repository = createWorkbookRepository(directory);
  const server = createServer(createApp(repository));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function getWorkbook(base, id = SEED_WORKBOOK_ID) {
  const response = await fetch(`${base}/api/workbooks/${id}`);
  return (await response.json()).workbook;
}

function putCell(base, sheetId, cellId, value, workbookId = SEED_WORKBOOK_ID) {
  return fetch(`${base}/api/workbooks/${workbookId}/worksheets/${sheetId}/cells/${cellId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value }),
  });
}

function paste(base, sheetId, cell, values, workbookId = SEED_WORKBOOK_ID) {
  return fetch(`${base}/api/workbooks/${workbookId}/worksheets/${sheetId}/paste`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cell, values }),
  });
}

function saveValidation(base, sheetId, payload, workbookId = SEED_WORKBOOK_ID) {
  return fetch(`${base}/api/workbooks/${workbookId}/worksheets/${sheetId}/validations`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

test("keeps submitted formulas, recalculates dependents and persists both after reload", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const saved = await putCell(server.base, SEED_WORKSHEET_ID, "D1", "=B2+B3");
  assert.equal(saved.status, 200);
  const updated = (await saved.json()).workbook;
  const sheet = updated.worksheets[0];
  assert.equal(sheet.cells.D1.value, "=B2+B3");
  assert.equal(sheet.cells.D1.display, "2000");

  const chained = await putCell(server.base, SEED_WORKSHEET_ID, "E1", "=D1*2");
  assert.equal((await chained.json()).workbook.worksheets[0].cells.E1.display, "4000");

  const source = await putCell(server.base, SEED_WORKSHEET_ID, "B2", "1500");
  const recalculated = (await source.json()).workbook.worksheets[0];
  assert.equal(recalculated.cells.B2.display, "1500");
  assert.equal(recalculated.cells.D1.display, "2300");
  assert.equal(recalculated.cells.E1.display, "4600");

  const reloaded = await getWorkbook(server.base);
  assert.equal(reloaded.worksheets[0].cells.D1.value, "=B2+B3");
  assert.equal(reloaded.worksheets[0].cells.D1.display, "2300");
  assert.equal(reloaded.worksheets[0].cells.E1.display, "4600");
  assert.equal(reloaded.worksheets[0].cells.A1.value, "Region");
});

test("applies a pasted two dimensional table completely and preserves empty fields", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const response = await paste(server.base, SEED_WORKSHEET_ID, "D1", [
    ["East", "1200"],
    ["North", ""],
  ]);
  assert.equal(response.status, 200);
  const sheet = (await response.json()).workbook.worksheets[0];
  assert.equal(sheet.cells.D1.value, "East");
  assert.equal(sheet.cells.E1.value, "1200");
  assert.equal(sheet.cells.D2.value, "North");
  assert.equal(sheet.cells.E2, undefined);
  assert.equal(sheet.cells.A1.value, "Region");

  const reloaded = await getWorkbook(server.base);
  assert.equal(reloaded.worksheets[0].cells.D1.value, "East");
  assert.equal(reloaded.worksheets[0].cells.E1.value, "1200");
  assert.equal(reloaded.worksheets[0].cells.D2.value, "North");
});

test("replaces formulas inside the pasted rectangle and recalculates related formulas", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  await putCell(server.base, SEED_WORKSHEET_ID, "C1", "=1+1");
  await putCell(server.base, SEED_WORKSHEET_ID, "C2", "=C1*3");
  assert.equal((await getWorkbook(server.base)).worksheets[0].cells.C2.display, "6");

  const response = await paste(server.base, SEED_WORKSHEET_ID, "C1", [["5"]]);
  assert.equal(response.status, 200);
  const sheet = (await response.json()).workbook.worksheets[0];
  assert.equal(sheet.cells.C1.value, "5");
  assert.equal(sheet.cells.C1.display, "5");
  assert.equal(sheet.cells.C2.display, "15");

  const reloaded = await getWorkbook(server.base);
  assert.equal(reloaded.worksheets[0].cells.C2.value, "=C1*3");
  assert.equal(reloaded.worksheets[0].cells.C2.display, "15");
});

test("rejects a paste that a 0-to-100 rule refuses and keeps every target value", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const rule = await saveValidation(server.base, SEED_WORKSHEET_ID, {
    range: "D1:E2",
    type: "numberRange",
    min: 0,
    max: 100,
    message: "Please enter a number from 0 to 100",
  });
  assert.equal(rule.status, 200);
  const withRule = (await rule.json()).workbook.worksheets[0];
  assert.equal(withRule.validations.length, 1);
  assert.deepEqual(withRule.validations[0].range, { top: 1, bottom: 2, left: 4, right: 5 });

  const rejected = await paste(server.base, SEED_WORKSHEET_ID, "D1", [
    ["50", "1200"],
    ["North", "80"],
  ]);
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error, "Please enter a number from 0 to 100");

  const sheet = (await getWorkbook(server.base)).worksheets[0];
  assert.equal(sheet.cells.D1, undefined);
  assert.equal(sheet.cells.E1, undefined);
  assert.equal(sheet.cells.D2, undefined);
  assert.equal(sheet.cells.E2, undefined);

  const accepted = await paste(server.base, SEED_WORKSHEET_ID, "D1", [
    ["50", "0"],
    ["", "100"],
  ]);
  assert.equal(accepted.status, 200);
  const applied = (await accepted.json()).workbook.worksheets[0];
  assert.equal(applied.cells.D1.value, "50");
  assert.equal(applied.cells.E2.value, "100");
});

test("uses a text based message for a plain numeric range rule", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  await saveValidation(server.base, SEED_WORKSHEET_ID, { range: "F1:F3", type: "numberRange", min: 10, max: 20 });
  const rejected = await putCell(server.base, SEED_WORKSHEET_ID, "F2", "101");
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error, "Please enter a number between 10 and 20");

  const accepted = await putCell(server.base, SEED_WORKSHEET_ID, "F2", "15");
  assert.equal(accepted.status, 200);
  const cleared = await putCell(server.base, SEED_WORKSHEET_ID, "F2", "");
  assert.equal(cleared.status, 200);
  assert.equal((await getWorkbook(server.base)).worksheets[0].cells.F2, undefined);
});

test("stores the complete selection rectangle per worksheet without touching updatedAt", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const before = await getWorkbook(server.base);
  const timestamp = before.updatedAt;

  const selected = await fetch(`${server.base}/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selection: { anchor: { row: 1, column: 4 }, focus: { row: 2, column: 5 } } }),
  });
  assert.equal(selected.status, 200);
  const workbook = (await selected.json()).workbook;
  assert.deepEqual(workbook.worksheets[0].selection, {
    anchor: { row: 1, column: 4 },
    focus: { row: 2, column: 5 },
  });
  assert.equal(workbook.updatedAt, timestamp);

  const reloaded = await getWorkbook(server.base);
  assert.deepEqual(reloaded.worksheets[0].selection, {
    anchor: { row: 1, column: 4 },
    focus: { row: 2, column: 5 },
  });
  assert.equal(reloaded.updatedAt, timestamp);

  const invalid = await fetch(`${server.base}/api/workbooks/${SEED_WORKBOOK_ID}/worksheets/${SEED_WORKSHEET_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selection: { anchor: { row: 0, column: 1 } } }),
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual((await getWorkbook(server.base)).worksheets[0].selection, {
    anchor: { row: 1, column: 4 },
    focus: { row: 2, column: 5 },
  });
});

test("rejects malformed edits, pastes and unknown worksheets without changing stored data", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const before = JSON.stringify(await getWorkbook(server.base));

  const badCell = await putCell(server.base, SEED_WORKSHEET_ID, "nope", "x");
  assert.equal(badCell.status, 400);

  const badSheet = await putCell(server.base, "ws_missing", "A1", "x");
  assert.equal(badSheet.status, 404);

  const emptyPaste = await paste(server.base, SEED_WORKSHEET_ID, "A1", []);
  assert.equal(emptyPaste.status, 400);
  assert.equal((await emptyPaste.json()).error, "Nothing to paste");

  const badPasteCell = await paste(server.base, SEED_WORKSHEET_ID, "??", [["1"]]);
  assert.equal(badPasteCell.status, 400);

  const unknownWorkbook = await paste(server.base, SEED_WORKSHEET_ID, "A1", [["1"]], "wb_missing");
  assert.equal(unknownWorkbook.status, 404);

  assert.equal(JSON.stringify(await getWorkbook(server.base)), before);
});

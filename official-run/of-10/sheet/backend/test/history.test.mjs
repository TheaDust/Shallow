import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { SEED_WORKBOOK_ID, SEED_WORKSHEET_ID } from "../src/lib/seed.mjs";
import { createWorkbookRepository } from "../src/lib/workbook-store.mjs";

/**
 * REQ-3-2-2: the session history of one workbook undoes and redoes cell edits, pastes, range moves
 * and row/column structure changes. Tests use two repositories over the same data directory when
 * they need to tell "kept in memory" from "written to the store".
 */
async function startTestServer(directory) {
  const dataDirectory = directory ?? (await mkdtemp(join(tmpdir(), "shallowcode-history-")));
  const repository = createWorkbookRepository(dataDirectory);
  const server = createServer(createApp(repository));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  let closed = false;
  return {
    directory: dataDirectory,
    base: `http://127.0.0.1:${port}`,
    async close() {
      if (closed) return;
      closed = true;
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function getWorkbook(base, id = SEED_WORKBOOK_ID) {
  const response = await fetch(`${base}/api/workbooks/${id}`);
  return response.json();
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

function transfer(base, sheetId, payload, workbookId = SEED_WORKBOOK_ID) {
  return fetch(`${base}/api/workbooks/${workbookId}/worksheets/${sheetId}/transfer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function structure(base, sheetId, payload, workbookId = SEED_WORKBOOK_ID) {
  return fetch(`${base}/api/workbooks/${workbookId}/worksheets/${sheetId}/structure`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function historyStep(base, step, workbookId = SEED_WORKBOOK_ID) {
  return fetch(`${base}/api/workbooks/${workbookId}/${step}`, { method: "POST" });
}

function saveValidation(base, sheetId, payload, workbookId = SEED_WORKBOOK_ID) {
  return fetch(`${base}/api/workbooks/${workbookId}/worksheets/${sheetId}/validations`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function createWorkbook(base, name) {
  return fetch(`${base}/api/workbooks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

test("undo restores an edited cell and redo reapplies it, both staying in the store", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const fresh = await getWorkbook(server.base);
  assert.equal(fresh.canUndo, false);
  assert.equal(fresh.canRedo, false);

  const edited = await putCell(server.base, SEED_WORKSHEET_ID, "D1", "East");
  const afterEdit = await edited.json();
  assert.equal(afterEdit.workbook.worksheets[0].cells.D1.value, "East");
  assert.equal(afterEdit.canUndo, true);
  assert.equal(afterEdit.canRedo, false);

  const undone = await historyStep(server.base, "undo");
  assert.equal(undone.status, 200);
  const reverted = await undone.json();
  assert.equal(reverted.workbook.worksheets[0].cells.D1, undefined);
  assert.equal(reverted.canUndo, false);
  assert.equal(reverted.canRedo, true);

  // The undone state is written to the store, not only kept in memory.
  const reloaded = await getWorkbook(server.base);
  assert.equal(reloaded.workbook.worksheets[0].cells.D1, undefined);

  const redone = await historyStep(server.base, "redo");
  const applied = await redone.json();
  assert.equal(applied.workbook.worksheets[0].cells.D1.value, "East");
  assert.equal(applied.canUndo, true);
  assert.equal(applied.canRedo, false);

  const persisted = await getWorkbook(server.base);
  assert.equal(persisted.workbook.worksheets[0].cells.D1.value, "East");
});

test("a reopened session keeps the state a redo wrote but starts without its history", async (t) => {
  const first = await startTestServer();
  t.after(() => first.close());
  await putCell(first.base, SEED_WORKSHEET_ID, "D1", "East");
  assert.equal((await getWorkbook(first.base)).canUndo, true);
  await first.close();

  // A new repository over the same directory is a fresh session: the value stayed, the log did not.
  const second = await startTestServer(first.directory);
  t.after(() => second.close());
  const reopened = await getWorkbook(second.base);
  assert.equal(reopened.workbook.worksheets[0].cells.D1.value, "East");
  assert.equal(reopened.canUndo, false);
  assert.equal(reopened.canRedo, false);
});

test("consecutive undos restore changes in reverse order and redo replays them in order", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  await putCell(server.base, SEED_WORKSHEET_ID, "D1", "first");
  await putCell(server.base, SEED_WORKSHEET_ID, "D2", "second");
  await putCell(server.base, SEED_WORKSHEET_ID, "D3", "third");

  const firstUndo = await (await historyStep(server.base, "undo")).json();
  assert.equal(firstUndo.workbook.worksheets[0].cells.D3, undefined);
  assert.equal(firstUndo.workbook.worksheets[0].cells.D2.value, "second");

  const secondUndo = await (await historyStep(server.base, "undo")).json();
  assert.equal(secondUndo.workbook.worksheets[0].cells.D2, undefined);
  assert.equal(secondUndo.workbook.worksheets[0].cells.D1.value, "first");
  assert.equal(secondUndo.canUndo, true);
  assert.equal(secondUndo.canRedo, true);

  const firstRedo = await (await historyStep(server.base, "redo")).json();
  assert.equal(firstRedo.workbook.worksheets[0].cells.D2.value, "second");
  assert.equal(firstRedo.workbook.worksheets[0].cells.D3, undefined);

  const secondRedo = await (await historyStep(server.base, "redo")).json();
  assert.equal(secondRedo.workbook.worksheets[0].cells.D3.value, "third");
  assert.equal(secondRedo.canRedo, false);
});

test("a new change after an undo drops the redo branch", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  await putCell(server.base, SEED_WORKSHEET_ID, "D1", "East");
  await historyStep(server.base, "undo");
  assert.equal((await getWorkbook(server.base)).canRedo, true);

  const replacement = await putCell(server.base, SEED_WORKSHEET_ID, "E1", "West");
  const afterReplace = await replacement.json();
  assert.equal(afterReplace.canRedo, false);
  assert.equal(afterReplace.canUndo, true);

  const refused = await historyStep(server.base, "redo");
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, "There is nothing to redo");
  const sheet = (await getWorkbook(server.base)).workbook.worksheets[0];
  assert.equal(sheet.cells.E1.value, "West");
  assert.equal(sheet.cells.D1, undefined);
});

test("an empty history answers 409 and leaves the stored workbook untouched", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const before = JSON.stringify((await getWorkbook(server.base)).workbook);

  const undo = await historyStep(server.base, "undo");
  assert.equal(undo.status, 409);
  const redo = await historyStep(server.base, "redo");
  assert.equal(redo.status, 409);

  assert.equal(JSON.stringify((await getWorkbook(server.base)).workbook), before);
  const missing = await historyStep(server.base, "undo", "wb_missing");
  assert.equal(missing.status, 404);
});

test("undo brings back the values and formulas a paste replaced and recalculates their dependents", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  await putCell(server.base, SEED_WORKSHEET_ID, "D1", "=B2+B3");
  await putCell(server.base, SEED_WORKSHEET_ID, "E1", "=D1*2");
  await putCell(server.base, SEED_WORKSHEET_ID, "F1", "=D1+E1");
  const before = (await getWorkbook(server.base)).workbook.worksheets[0];
  assert.equal(before.cells.D1.display, "2000");
  assert.equal(before.cells.E1.display, "4000");
  assert.equal(before.cells.F1.display, "6000");

  const pasted = await paste(server.base, SEED_WORKSHEET_ID, "D1", [["10", "20"]]);
  const applied = (await pasted.json()).workbook.worksheets[0];
  assert.equal(applied.cells.D1.value, "10");
  assert.equal(applied.cells.E1.value, "20");
  assert.equal(applied.cells.F1.display, "30");

  const undone = (await (await historyStep(server.base, "undo")).json()).workbook.worksheets[0];
  assert.equal(undone.cells.D1.value, "=B2+B3");
  assert.equal(undone.cells.D1.display, "2000");
  assert.equal(undone.cells.E1.value, "=D1*2");
  assert.equal(undone.cells.E1.display, "4000");
  assert.equal(undone.cells.F1.value, "=D1+E1");
  assert.equal(undone.cells.F1.display, "6000");
  assert.equal(undone.cells.A1.value, "Region");

  const redone = (await (await historyStep(server.base, "redo")).json()).workbook.worksheets[0];
  assert.equal(redone.cells.D1.value, "10");
  assert.equal(redone.cells.F1.display, "30");
});

test("undo restores a moved range: the target rectangle and the cleared source", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const moved = await transfer(server.base, SEED_WORKSHEET_ID, {
    mode: "cut",
    source: { top: 1, bottom: 2, left: 1, right: 2 },
    target: "D1",
  });
  const applied = (await moved.json()).workbook.worksheets[0];
  assert.equal(applied.cells.D1.value, "Region");
  assert.equal(applied.cells.E2.value, "1200");
  assert.equal(applied.cells.A1, undefined);
  assert.equal(applied.cells.B2, undefined);

  const undone = (await (await historyStep(server.base, "undo")).json()).workbook.worksheets[0];
  assert.equal(undone.cells.A1.value, "Region");
  assert.equal(undone.cells.B2.value, "1200");
  assert.equal(undone.cells.D1, undefined);
  assert.equal(undone.cells.E2, undefined);

  const redone = (await (await historyStep(server.base, "redo")).json()).workbook.worksheets[0];
  assert.equal(redone.cells.D1.value, "Region");
  assert.equal(redone.cells.A1, undefined);
  assert.equal(redone.cells.B2, undefined);

  const reloaded = (await getWorkbook(server.base)).workbook.worksheets[0];
  assert.equal(reloaded.cells.D1.value, "Region");
  assert.equal(reloaded.cells.A2, undefined);
});

test("undo restores row structure together with formula references and rule ranges", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  await putCell(server.base, SEED_WORKSHEET_ID, "D1", "=A2");
  await saveValidation(server.base, SEED_WORKSHEET_ID, {
    range: "A1:B2",
    type: "numberRange",
    min: 0,
    max: 100,
    message: "Please enter a number from 0 to 100",
  });
  await putCell(server.base, SEED_WORKSHEET_ID, "D2", "5");
  const started = (await getWorkbook(server.base)).workbook.worksheets[0];
  assert.equal(started.cells.D1.value, "=A2");
  assert.equal(started.validations[0].range.bottom, 2);

  const inserted = await structure(server.base, SEED_WORKSHEET_ID, { axis: "row", op: "insert", index: 1, side: "before" });
  const shifted = (await inserted.json()).workbook.worksheets[0];
  assert.equal(shifted.cells.D2.value, "=A3");
  assert.equal(shifted.cells.D2.display, "East");
  assert.equal(shifted.validations[0].range.top, 2);
  assert.equal(shifted.validations[0].range.bottom, 3);
  assert.equal(shifted.rowCount, started.rowCount + 1);

  const undone = (await (await historyStep(server.base, "undo")).json()).workbook.worksheets[0];
  assert.equal(undone.cells.D1.value, "=A2");
  assert.equal(undone.cells.D1.display, "East");
  assert.deepEqual(undone.validations[0].range, { top: 1, bottom: 2, left: 1, right: 2 });
  assert.equal(undone.rowCount, started.rowCount);
  assert.equal(undone.cells.A1.value, "Region");

  const redone = (await (await historyStep(server.base, "redo")).json()).workbook.worksheets[0];
  assert.equal(redone.cells.D2.value, "=A3");
  assert.deepEqual(redone.validations[0].range, { top: 2, bottom: 3, left: 1, right: 2 });

  const reloaded = (await getWorkbook(server.base)).workbook.worksheets[0];
  assert.equal(reloaded.cells.D2.value, "=A3");
  assert.equal(reloaded.validations[0].range.top, 2);
});

test("undo restores a deleted column and the values outside it", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const deleted = await structure(server.base, SEED_WORKSHEET_ID, {
    axis: "column",
    op: "delete",
    index: 2,
  });
  const remaining = (await deleted.json()).workbook.worksheets[0];
  assert.equal(remaining.cells.A1.value, "Region");
  assert.equal(remaining.cells.B1.value, "Status");
  assert.equal(remaining.cells.B2.value, "Open");

  const undone = (await (await historyStep(server.base, "undo")).json()).workbook.worksheets[0];
  assert.equal(undone.cells.B1.value, "Sales");
  assert.equal(undone.cells.B2.value, "1200");
  assert.equal(undone.cells.C1.value, "Status");
});

test("the history of one workbook never undoes or blocks another workbook", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const created = await (await createWorkbook(server.base, "Other book")).json();
  const otherId = created.workbook.id;
  const otherSheetId = created.workbook.worksheets[0].id;

  await putCell(server.base, otherSheetId, "A1", "Other value", otherId);
  await putCell(server.base, SEED_WORKSHEET_ID, "D1", "East");

  const undone = (await (await historyStep(server.base, "undo")).json());
  assert.equal(undone.workbook.id, SEED_WORKBOOK_ID);
  assert.equal(undone.workbook.worksheets[0].cells.D1, undefined);

  // The other workbook kept its own edit and its own history.
  const other = await getWorkbook(server.base, otherId);
  assert.equal(other.workbook.worksheets[0].cells.A1.value, "Other value");
  assert.equal(other.canUndo, true);
  assert.equal(other.canRedo, false);

  const otherUndo = await (await historyStep(server.base, "undo", otherId)).json();
  assert.equal(otherUndo.workbook.worksheets[0].cells.A1, undefined);
  const seeded = await getWorkbook(server.base);
  assert.equal(seeded.workbook.worksheets[0].cells.D1, undefined);
});

test("a refused paste leaves no history entry", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  await saveValidation(server.base, SEED_WORKSHEET_ID, {
    range: "D1:E2",
    type: "numberRange",
    min: 0,
    max: 100,
    message: "Please enter a number from 0 to 100",
  });
  const rejected = await paste(server.base, SEED_WORKSHEET_ID, "D1", [["50", "1200"]]);
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error, "Please enter a number from 0 to 100");

  const state = await getWorkbook(server.base);
  assert.equal(state.canUndo, false);
  assert.equal(state.canRedo, false);
  assert.equal(state.workbook.worksheets[0].cells.D1, undefined);

  const undo = await historyStep(server.base, "undo");
  assert.equal(undo.status, 409);
});

import test from "node:test";
import assert from "node:assert/strict";

import { createJsonStore } from "../src/lib/json-store.mjs";
import { createSeedState } from "../src/domain/workbooks.mjs";
import { request, startApp } from "./support.mjs";

const WORKBOOK = "/api/workbooks/wb-q3-sales";
const SHEET1 = `${WORKBOOK}/worksheets/ws-q3-sheet1`;

function sheetOf(workbook, id = "ws-q3-sheet1") {
  return workbook.worksheets.find((sheet) => sheet.id === id);
}

function write(baseUrl, updates, worksheetId = "ws-q3-sheet1") {
  return request(baseUrl, `${WORKBOOK}/worksheets/${worksheetId}/cells`, {
    method: "POST",
    body: JSON.stringify({ updates }),
  });
}

function history(baseUrl, direction) {
  return request(baseUrl, `${WORKBOOK}/${direction}`, { method: "POST", body: JSON.stringify({}) });
}

function persistedSheet(app) {
  return createJsonStore(app.storePath, createSeedState())
    .read()
    .then((state) => sheetOf(state.workbooks[0]));
}

test("a fresh workbook has nothing to undo or redo", async () => {
  const app = await startApp();
  try {
    const opened = await request(app.baseUrl, WORKBOOK);
    assert.equal(opened.body.workbook.canUndo, false);
    assert.equal(opened.body.workbook.canRedo, false);

    const undo = await history(app.baseUrl, "undo");
    assert.equal(undo.status, 400);
    assert.equal(undo.body.error, "Nothing to undo");
    const redo = await history(app.baseUrl, "redo");
    assert.equal(redo.status, 400);
    assert.equal(redo.body.error, "Nothing to redo");
  } finally {
    await app.close();
  }
});

test("undo restores the values and formulas of the last cell edit and redo reapplies it", async () => {
  const app = await startApp();
  try {
    await write(app.baseUrl, { D1: "East", D2: "=E2*2", E2: "5" });
    const edited = await request(app.baseUrl, WORKBOOK);
    const editedSheet = sheetOf(edited.body.workbook);
    assert.equal(editedSheet.values.D2, "10");
    assert.equal(edited.body.workbook.canUndo, true);
    assert.equal(edited.body.workbook.canRedo, false);

    const undone = await history(app.baseUrl, "undo");
    assert.equal(undone.status, 200);
    const undoneSheet = sheetOf(undone.body.workbook);
    assert.equal(Object.hasOwn(undoneSheet.cells, "D1"), false);
    assert.equal(Object.hasOwn(undoneSheet.cells, "D2"), false);
    assert.equal(Object.hasOwn(undoneSheet.cells, "E2"), false);
    assert.equal(undone.body.workbook.canUndo, false);
    assert.equal(undone.body.workbook.canRedo, true);

    // The state after the undo is persisted, not only held in memory.
    const stored = await persistedSheet(app);
    assert.equal(Object.hasOwn(stored.cells, "D1"), false);
    assert.equal(stored.cells.A1, "Region");

    const redone = await history(app.baseUrl, "redo");
    assert.equal(redone.status, 200);
    const redoneSheet = sheetOf(redone.body.workbook);
    assert.equal(redoneSheet.cells.D1, "East");
    assert.equal(redoneSheet.cells.D2, "=E2*2");
    assert.equal(redoneSheet.values.D2, "10");
    assert.equal(redone.body.workbook.canRedo, false);

    const storedAgain = await persistedSheet(app);
    assert.equal(storedAgain.cells.D2, "=E2*2");
    assert.equal(storedAgain.cells.E2, "5");
  } finally {
    await app.close();
  }
});

test("consecutive undo operations restore the changes in reverse order", async () => {
  const app = await startApp();
  try {
    await write(app.baseUrl, { D1: "first" });
    await write(app.baseUrl, { D2: "second" });
    await write(app.baseUrl, { D3: "third" });

    const back = await history(app.baseUrl, "undo");
    assert.equal(sheetOf(back.body.workbook).cells.D2, "second");
    assert.equal(Object.hasOwn(sheetOf(back.body.workbook).cells, "D3"), false);

    const further = await history(app.baseUrl, "undo");
    assert.equal(sheetOf(further.body.workbook).cells.D1, "first");
    assert.equal(Object.hasOwn(sheetOf(further.body.workbook).cells, "D2"), false);

    const both = await history(app.baseUrl, "redo");
    assert.equal(sheetOf(both.body.workbook).cells.D2, "second");
    const again = await history(app.baseUrl, "redo");
    assert.equal(sheetOf(again.body.workbook).cells.D3, "third");
    assert.equal(again.body.workbook.canRedo, false);
  } finally {
    await app.close();
  }
});

test("undo restores a row insertion together with the shifted rule ranges", async () => {
  const app = await startApp();
  try {
    await request(app.baseUrl, SHEET1, {
      method: "PATCH",
      body: JSON.stringify({ validations: [{ id: "qty", range: "D2:E3", type: "number-between", min: 0, max: 100 }] }),
    });
    const inserted = await request(app.baseUrl, `${SHEET1}/rows`, {
      method: "POST",
      body: JSON.stringify({ op: "insert-row-above", row: 2 }),
    });
    const shifted = sheetOf(inserted.body.workbook);
    assert.equal(shifted.cells.A3, "East");
    assert.deepEqual(shifted.validations[0].range, { start: "D3", end: "E4" });

    const undone = await history(app.baseUrl, "undo");
    const restored = sheetOf(undone.body.workbook);
    assert.equal(restored.cells.A2, "East");
    assert.equal(Object.hasOwn(restored.cells, "A3"), true);
    assert.deepEqual(restored.validations[0].range, { start: "D2", end: "E3" });

    const stored = await persistedSheet(app);
    assert.equal(stored.cells.A2, "East");
    assert.deepEqual(stored.validations[0].range, { start: "D2", end: "E3" });
  } finally {
    await app.close();
  }
});

test("undo restores both ends of a cut range move", async () => {
  const app = await startApp();
  try {
    const cut = await request(app.baseUrl, `${SHEET1}/range-transfer`, {
      method: "POST",
      body: JSON.stringify({
        mode: "cut",
        source: { start: "A2", end: "B2" },
        target: { start: "D5", end: "E5" },
      }),
    });
    assert.equal(cut.status, 200);
    assert.equal(Object.hasOwn(sheetOf(cut.body.workbook).cells, "A2"), false);

    const undone = await history(app.baseUrl, "undo");
    const restored = sheetOf(undone.body.workbook);
    assert.equal(restored.cells.A2, "East");
    assert.equal(restored.cells.B2, "1200");
    assert.equal(Object.hasOwn(restored.cells, "D5"), false);
    assert.equal(Object.hasOwn(restored.cells, "E5"), false);
  } finally {
    await app.close();
  }
});

test("a new modification after an undo drops the redo branch", async () => {
  const app = await startApp();
  try {
    await write(app.baseUrl, { D1: "East" });
    await history(app.baseUrl, "undo");
    const afterUndo = await request(app.baseUrl, WORKBOOK);
    assert.equal(afterUndo.body.workbook.canRedo, true);

    const edited = await write(app.baseUrl, { D2: "North" });
    assert.equal(edited.body.workbook.canRedo, false);
    assert.equal(edited.body.workbook.canUndo, true);

    const redo = await history(app.baseUrl, "redo");
    assert.equal(redo.status, 400);
    assert.equal(redo.body.error, "Nothing to redo");
    const opened = await request(app.baseUrl, WORKBOOK);
    assert.equal(Object.hasOwn(sheetOf(opened.body.workbook).cells, "D1"), false);
    assert.equal(sheetOf(opened.body.workbook).cells.D2, "North");
  } finally {
    await app.close();
  }
});

test("a rejected write leaves the history and the state untouched", async () => {
  const app = await startApp();
  try {
    await request(app.baseUrl, SHEET1, {
      method: "PATCH",
      body: JSON.stringify({ validations: [{ range: "D1", type: "number-between", min: 0, max: 100 }] }),
    });
    const rejected = await write(app.baseUrl, { D1: "500" });
    assert.equal(rejected.status, 400);

    const opened = await request(app.baseUrl, WORKBOOK);
    assert.equal(opened.body.workbook.canUndo, false);
    assert.equal(Object.hasOwn(sheetOf(opened.body.workbook).cells, "D1"), false);
  } finally {
    await app.close();
  }
});

test("undo in one workbook does not modify another workbook", async () => {
  const app = await startApp();
  try {
    const other = await request(app.baseUrl, "/api/workbooks", {
      method: "POST",
      body: JSON.stringify({ name: "Other book" }),
    });
    assert.equal(other.status, 201);
    const otherId = other.body.workbook.id;
    const otherSheetId = other.body.workbook.worksheets[0].id;

    await write(app.baseUrl, { D1: "East" });
    const otherWrite = await request(app.baseUrl, `/api/workbooks/${otherId}/worksheets/${otherSheetId}/cells`, {
      method: "POST",
      body: JSON.stringify({ updates: { A1: "keep" } }),
    });
    assert.equal(otherWrite.status, 200);

    const undone = await history(app.baseUrl, "undo");
    assert.equal(undone.status, 200);
    assert.equal(Object.hasOwn(sheetOf(undone.body.workbook).cells, "D1"), false);

    const reopened = await request(app.baseUrl, `/api/workbooks/${otherId}`);
    assert.equal(reopened.body.workbook.worksheets[0].cells.A1, "keep");
    assert.equal(reopened.body.workbook.canUndo, true);
  } finally {
    await app.close();
  }
});

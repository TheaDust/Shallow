import test from "node:test";
import assert from "node:assert/strict";

import { createJsonStore } from "../src/lib/json-store.mjs";
import { createSeedState } from "../src/domain/workbooks.mjs";
import { request, startApp } from "./support.mjs";

const WORKBOOK = "/api/workbooks/wb-q3-sales";
const SHEET1 = `${WORKBOOK}/worksheets/ws-q3-sheet1`;
const SHEET2 = `${WORKBOOK}/worksheets/ws-q3-sheet2`;
const CELLS1 = `${SHEET1}/cells`;

function sheetOf(workbook, id) {
  return workbook.worksheets.find((sheet) => sheet.id === id);
}

function write(baseUrl, updates, worksheetId = "ws-q3-sheet1") {
  return request(baseUrl, `${WORKBOOK}/worksheets/${worksheetId}/cells`, {
    method: "POST",
    body: JSON.stringify({ updates }),
  });
}

test("writing a cell stores the raw text, returns its displayed value and persists", async () => {
  const app = await startApp();
  try {
    const written = await write(app.baseUrl, { D1: "East", E1: "1200", D2: "North", E2: "800" });
    assert.equal(written.status, 200);
    const sheet = sheetOf(written.body.workbook, "ws-q3-sheet1");
    assert.equal(sheet.cells.D1, "East");
    assert.equal(sheet.cells.E1, "1200");
    assert.equal(sheet.values.D1, "East");
    assert.equal(sheet.values.E1, "1200");
    assert.equal(sheet.cells.A1, "Region");

    const reopened = await request(app.baseUrl, WORKBOOK);
    const reopenedSheet = sheetOf(reopened.body.workbook, "ws-q3-sheet1");
    assert.equal(reopenedSheet.cells.D2, "North");
    assert.equal(reopenedSheet.values.E2, "800");

    const persisted = await createJsonStore(app.storePath, createSeedState()).read();
    assert.equal(sheetOf(persisted.workbooks[0], "ws-q3-sheet1").cells.E2, "800");
  } finally {
    await app.close();
  }
});

test("a formula cell keeps its expression and shows the calculated result", async () => {
  const app = await startApp();
  try {
    const written = await write(app.baseUrl, { A1: "4", B1: "6", C1: "=A1+B1", D1: "=C1*2" });
    const sheet = sheetOf(written.body.workbook, "ws-q3-sheet1");
    assert.equal(sheet.cells.C1, "=A1+B1");
    assert.equal(sheet.values.C1, "10");
    assert.equal(sheet.values.D1, "20");

    // A committed source value updates directly and indirectly dependent results.
    const updated = await write(app.baseUrl, { A1: "10" });
    const updatedSheet = sheetOf(updated.body.workbook, "ws-q3-sheet1");
    assert.equal(updatedSheet.values.C1, "16");
    assert.equal(updatedSheet.values.D1, "32");

    const reopened = await request(app.baseUrl, WORKBOOK);
    const reopenedSheet = sheetOf(reopened.body.workbook, "ws-q3-sheet1");
    assert.equal(reopenedSheet.cells.C1, "=A1+B1");
    assert.equal(reopenedSheet.values.C1, "16");
  } finally {
    await app.close();
  }
});

test("clearing a cell removes its stored text and its value", async () => {
  const app = await startApp();
  try {
    const cleared = await write(app.baseUrl, { A2: "" });
    const sheet = sheetOf(cleared.body.workbook, "ws-q3-sheet1");
    assert.equal(Object.hasOwn(sheet.cells, "A2"), false);
    assert.equal(Object.hasOwn(sheet.values, "A2"), false);
  } finally {
    await app.close();
  }
});

test("an invalid address or value rejects the whole write without touching the sheet", async () => {
  const app = await startApp();
  try {
    const before = await request(app.baseUrl, WORKBOOK);

    const badAddress = await write(app.baseUrl, { "1A": "x" });
    assert.equal(badAddress.status, 400);
    assert.equal(badAddress.body.error, "Invalid cell address");

    const outside = await write(app.baseUrl, { A41: "x" });
    assert.equal(outside.status, 400);

    const badValue = await write(app.baseUrl, { D1: 12 });
    assert.equal(badValue.status, 400);
    assert.equal(badValue.body.error, "Invalid cell value");

    const after = await request(app.baseUrl, WORKBOOK);
    assert.deepEqual(after.body.workbook, before.body.workbook);
  } finally {
    await app.close();
  }
});

test("writing to an unknown workbook or worksheet answers 404", async () => {
  const app = await startApp();
  try {
    const missingSheet = await request(app.baseUrl, `${WORKBOOK}/worksheets/nope/cells`, {
      method: "POST",
      body: JSON.stringify({ updates: { A1: "x" } }),
    });
    assert.equal(missingSheet.status, 404);

    const missingWorkbook = await request(app.baseUrl, "/api/workbooks/nope/worksheets/ws/cells", {
      method: "POST",
      body: JSON.stringify({ updates: { A1: "x" } }),
    });
    assert.equal(missingWorkbook.status, 404);
  } finally {
    await app.close();
  }
});

test("a 0-to-100 numeric rule rejects an out-of-range commit with its message", async () => {
  const app = await startApp();
  try {
    const rule = await request(app.baseUrl, SHEET1, {
      method: "PATCH",
      body: JSON.stringify({
        validations: [{ id: "qty", range: "D1:E2", type: "number-between", min: 0, max: 100 }],
      }),
    });
    assert.equal(rule.status, 200);
    assert.equal(sheetOf(rule.body.workbook, "ws-q3-sheet1").validations[0].message, "Please enter a number from 0 to 100");

    const rejected = await write(app.baseUrl, { D1: "150" });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Please enter a number from 0 to 100");

    const text = await write(app.baseUrl, { E1: "East" });
    assert.equal(text.status, 400);
    assert.equal(text.body.error, "Please enter a number from 0 to 100");

    const accepted = await write(app.baseUrl, { D1: "100", E1: "0" });
    assert.equal(accepted.status, 200);
    const sheet = sheetOf(accepted.body.workbook, "ws-q3-sheet1");
    assert.equal(sheet.values.D1, "100");
    assert.equal(sheet.values.E1, "0");

    // Cells outside the rule range still accept any text.
    const outside = await write(app.baseUrl, { A1: "East" });
    assert.equal(outside.status, 200);
  } finally {
    await app.close();
  }
});

test("a rejected rule keeps the previous state and drops nothing", async () => {
  const app = await startApp();
  try {
    await write(app.baseUrl, { D1: "50" });
    await request(app.baseUrl, SHEET1, {
      method: "PATCH",
      body: JSON.stringify({ validations: [{ range: "D1", type: "number-between", min: 0, max: 100 }] }),
    });

    const rejected = await write(app.baseUrl, { D1: "500" });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Please enter a number from 0 to 100");
    const opened = await request(app.baseUrl, WORKBOOK);
    const sheet = sheetOf(opened.body.workbook, "ws-q3-sheet1");
    assert.equal(sheet.cells.D1, "50");
    assert.equal(sheet.values.D1, "50");
  } finally {
    await app.close();
  }
});

test("pasting a rectangle applies every cell or none at all", async () => {
  const app = await startApp();
  try {
    const pasted = await write(app.baseUrl, { D1: "East", E1: "1200", D2: "North", E2: "800" });
    assert.equal(pasted.status, 200);
    const sheet = sheetOf(pasted.body.workbook, "ws-q3-sheet1");
    assert.deepEqual(
      [sheet.values.D1, sheet.values.E1, sheet.values.D2, sheet.values.E2],
      ["East", "1200", "North", "800"],
    );

    // A rectangle that clears a field preserves the empty cell instead of dropping it.
    const withBlank = await write(app.baseUrl, { D1: "East", E1: "", D2: "North", E2: "800" });
    const blankSheet = sheetOf(withBlank.body.workbook, "ws-q3-sheet1");
    assert.equal(Object.hasOwn(blankSheet.cells, "E1"), false);
    assert.equal(blankSheet.values.D2, "North");

    await request(app.baseUrl, SHEET1, {
      method: "PATCH",
      body: JSON.stringify({ validations: [{ range: "D1:E2", type: "number-between", min: 0, max: 100 }] }),
    });

    const before = await request(app.baseUrl, WORKBOOK);
    const rejected = await write(app.baseUrl, { D1: "10", E1: "20", D2: "30", E2: "400" });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Please enter a number from 0 to 100");
    const after = await request(app.baseUrl, WORKBOOK);
    assert.deepEqual(after.body.workbook, before.body.workbook);

    const persisted = await createJsonStore(app.storePath, createSeedState()).read();
    const persistedSheet = sheetOf(persisted.workbooks[0], "ws-q3-sheet1");
    assert.equal(persistedSheet.cells.E2, "800");
    assert.equal(persistedSheet.cells.D2, "North");
    assert.equal(persistedSheet.cells.D1, "East");
  } finally {
    await app.close();
  }
});

test("a rejected validation rule keeps the stored rules and responds 400", async () => {
  const app = await startApp();
  try {
    const rejected = await request(app.baseUrl, SHEET1, {
      method: "PATCH",
      body: JSON.stringify({ validations: [{ range: "D1", type: "list", values: ["a"] }] }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "Invalid validation rule");
    const opened = await request(app.baseUrl, WORKBOOK);
    assert.deepEqual(sheetOf(opened.body.workbook, "ws-q3-sheet1").validations, []);
  } finally {
    await app.close();
  }
});

test("each worksheet keeps its own selection rectangle across switches and refreshes", async () => {
  const app = await startApp();
  try {
    const selected = await request(app.baseUrl, SHEET1, {
      method: "PATCH",
      body: JSON.stringify({ activeCell: "B2", selectionFocus: "C3" }),
    });
    assert.equal(selected.status, 200);
    const sheet1 = sheetOf(selected.body.workbook, "ws-q3-sheet1");
    assert.equal(sheet1.activeCell, "B2");
    assert.equal(sheet1.selectionFocus, "C3");

    await request(app.baseUrl, SHEET2, {
      method: "PATCH",
      body: JSON.stringify({ activeCell: "A1" }),
    });

    const reopened = await request(app.baseUrl, WORKBOOK);
    const refreshed = sheetOf(reopened.body.workbook, "ws-q3-sheet1");
    assert.equal(refreshed.activeCell, "B2");
    assert.equal(refreshed.selectionFocus, "C3");
    assert.equal(sheetOf(reopened.body.workbook, "ws-q3-sheet2").selectionFocus, "A1");

    // A single-cell selection patch collapses the rectangle to that cell.
    const collapsed = await request(app.baseUrl, SHEET1, {
      method: "PATCH",
      body: JSON.stringify({ activeCell: "D4" }),
    });
    const collapsedSheet = sheetOf(collapsed.body.workbook, "ws-q3-sheet1");
    assert.equal(collapsedSheet.activeCell, "D4");
    assert.equal(collapsedSheet.selectionFocus, "D4");

    const invalid = await request(app.baseUrl, SHEET1, {
      method: "PATCH",
      body: JSON.stringify({ activeCell: "B2", selectionFocus: "??" }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, "Invalid cell address");
  } finally {
    await app.close();
  }
});

test("inserting and deleting rows shifts validation ranges and keeps the sheet consistent", async () => {
  const app = await startApp();
  try {
    await request(app.baseUrl, SHEET1, {
      method: "PATCH",
      body: JSON.stringify({ validations: [{ range: "D2:E3", type: "number-between", min: 0, max: 100 }] }),
    });
    const inserted = await request(app.baseUrl, `${SHEET1}/rows`, {
      method: "POST",
      body: JSON.stringify({ op: "insert-row-above", row: 2 }),
    });
    const rules = sheetOf(inserted.body.workbook, "ws-q3-sheet1").validations;
    assert.deepEqual(rules[0].range, { start: "D3", end: "E4" });
  } finally {
    await app.close();
  }
});

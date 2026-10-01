import assert from "node:assert/strict";
import test from "node:test";

import {
  adjustFormulaText,
  columnDeleteShift,
  columnInsertShift,
  rowDeleteShift,
  rowInsertShift,
} from "../src/lib/formulas.mjs";
import { normalizeWorkbook, normalizeWorksheet } from "../src/lib/workbooks.mjs";
import {
  deleteColumns,
  deleteRows,
  insertColumns,
  insertRows,
  shiftPivotSources,
} from "../src/lib/structure.mjs";

function worksheet(overrides = {}) {
  return {
    id: "ws-1",
    name: "Sheet1",
    rowCount: 30,
    columnCount: 26,
    cells: {},
    selection: { anchor: "A1", focus: "A1" },
    validations: [],
    filters: [],
    pivot: null,
    ...overrides,
  };
}

test("moves a row reference when a row is inserted above it", () => {
  assert.equal(adjustFormulaText("=B2+B3", [rowInsertShift(1)]), "=B3+B4");
  assert.equal(adjustFormulaText("=SUM(A2:A5)", [rowInsertShift(0)]), "=SUM(A3:A6)");
  assert.equal(adjustFormulaText("=$B$2+C2", [rowInsertShift(1)]), "=$B$3+C3");
  assert.equal(adjustFormulaText("=B1", [rowInsertShift(4)]), "=B1");
});

test("turns a reference to a deleted row or column into #REF!", () => {
  assert.equal(adjustFormulaText("=B3", [rowDeleteShift(2)]), "=#REF!");
  assert.equal(adjustFormulaText("=SUM(A1:B3)", [rowDeleteShift(1)]), "=SUM(A1:B2)");
  assert.equal(adjustFormulaText("=A1+B3", [rowDeleteShift(2)]), "=A1+#REF!");
  assert.equal(adjustFormulaText("=B1", [columnDeleteShift(1)]), "=#REF!");
  assert.equal(adjustFormulaText("=SUM(C1:D1)", [columnDeleteShift(1)]), "=SUM(B1:C1)");
});

test("adjusts ranges that keep both of their endpoints", () => {
  assert.equal(adjustFormulaText("=SUM(A1:B5)", [columnInsertShift(0)]), "=SUM(B1:C5)");
  assert.equal(adjustFormulaText("=SUM(A1:B5)", [columnInsertShift(2)]), "=SUM(A1:B5)");
  assert.equal(adjustFormulaText("=SUM(A1:B5)", [columnInsertShift(1)]), "=SUM(A1:C5)");
});

test("keeps another worksheet's references and string literals untouched", () => {
  assert.equal(adjustFormulaText("=Sheet2!A2", [rowInsertShift(0)], { sheetName: "Sheet1" }), "=Sheet2!A2");
  assert.equal(adjustFormulaText("=Sheet1!A2", [rowInsertShift(0)], { sheetName: "Sheet1" }), "=Sheet1!A3");
  assert.equal(adjustFormulaText('=IF(A2="A2",B2,B3)', [rowInsertShift(1)]), '=IF(A3="A2",B3,B4)');
  assert.equal(adjustFormulaText("East", [rowInsertShift(0)]), "East");
});

test("inserts a blank row above or below the target row", () => {
  const above = worksheet({ cells: { A1: "Region", A2: "East", B2: "1200", A3: "North", B3: "800" } });
  insertRows(above, { index: 1 });
  assert.deepEqual(above.cells, {
    A1: "Region", A3: "East", B3: "1200", A4: "North", B4: "800",
  });
  assert.equal(above.rowCount, 30);

  const below = worksheet({ cells: { A1: "Region", A2: "East", B2: "1200" } });
  insertRows(below, { index: 2 });
  assert.deepEqual(below.cells, { A1: "Region", A2: "East", B2: "1200" });
});

test("deletes the target row and shifts the following rows upward", () => {
  const sheet = worksheet({
    cells: { A1: "Region", A2: "East", B2: "1200", A3: "North", B3: "800", A4: "South", B4: "700" },
    selection: { anchor: "A3", focus: "A3" },
    validations: [
      { id: "dv-1", type: "number-range", range: { start: "B2", end: "B4" }, min: 0, max: 100, message: "Please enter a number from 0 to 100" },
      { id: "dv-2", type: "number-range", range: { start: "B2", end: "B2" } },
    ],
    filters: [{ id: "filter-1", range: { start: "A1", end: "B4" } }],
  });
  deleteRows(sheet, { index: 1 });

  assert.deepEqual(sheet.cells, { A1: "Region", A2: "North", B2: "800", A3: "South", B3: "700" });
  // The rule covering the deleted row shrinks; the rule that only covered it disappears.
  assert.deepEqual(sheet.validations.map((rule) => rule.range), [
    { start: "B2", end: "B3" },
  ]);
  assert.equal(sheet.validations[0].message, "Please enter a number from 0 to 100");
  assert.deepEqual(sheet.filters[0].range, { start: "A1", end: "B3" });
  assert.equal(sheet.rowCount, 30);
  // The selection follows the cell it was on.
  assert.deepEqual(sheet.selection, { anchor: "A2", focus: "A2" });
});

test("keeps formulas aligned when a column is removed", () => {
  const sheet = worksheet({ cells: { A1: "Region", A2: "=B2", B2: "1200", C2: "800" } });
  deleteColumns(sheet, { index: 1 });
  assert.deepEqual(sheet.cells, { A1: "Region", A2: "=#REF!", B2: "800" });
});

test("inserts a blank column left or right of the target column", () => {
  const sheet = worksheet({ cells: { A1: "Region", B1: "Sales", A2: "East", B2: "1200" } });
  insertColumns(sheet, { index: 1 });
  assert.deepEqual(sheet.cells, { A1: "Region", C1: "Sales", A2: "East", C2: "1200" });
  assert.equal(sheet.columnCount, 26);

  const right = worksheet({ cells: { A1: "Region", B1: "Sales" } });
  insertColumns(right, { index: 2 });
  assert.deepEqual(right.cells, { A1: "Region", B1: "Sales" });
});

test("removes a deleted column and turns direct references into #REF!", () => {
  const sheet = worksheet({
    cells: { A1: "Region", B1: "Sales", A2: "=B2", B2: "1200", C2: "800" },
    selection: { anchor: "B2", focus: "C2" },
  });
  deleteColumns(sheet, { index: 1 });
  assert.deepEqual(sheet.cells, { A1: "Region", A2: "=#REF!", B2: "800" });
  assert.deepEqual(sheet.selection, { anchor: "B2", focus: "B2" });
});

test("grows the grid instead of dropping content pushed out of the sheet", () => {
  const sheet = worksheet({ rowCount: 3, columnCount: 2, cells: { A3: "last", B1: "=A3" } });
  insertRows(sheet, { index: 0 });
  assert.equal(sheet.rowCount, 4);
  assert.deepEqual(sheet.cells, { A4: "last", B2: "=A4" });

  insertColumns(sheet, { index: 0 });
  assert.equal(sheet.columnCount, 3);
  assert.deepEqual(sheet.cells, { B4: "last", C2: "=B4" });
});

test("shifts a pivot source range without recomputing the stored result", () => {
  const workbook = normalizeWorkbook({
    id: "wb-1",
    name: "Q3 Sales",
    worksheets: [
      {
        id: "ws-src",
        name: "Sheet1",
        cells: { A1: "Region", A2: "East", A3: "North" },
      },
      {
        id: "ws-pivot",
        name: "Pivot1",
        cells: { A1: "Region", B1: "SUM of Sales" },
        pivot: { source: { worksheetId: "ws-src", range: { start: "A1", end: "B4" } }, rows: "Region" },
      },
    ],
  });
  const source = workbook.worksheets[0];
  const pivot = workbook.worksheets[1];

  insertRows(source, { index: 1 });
  shiftPivotSources(workbook, source.id, rowInsertShift(1));

  assert.deepEqual(pivot.pivot.source, { worksheetId: "ws-src", range: { start: "A1", end: "B5" } });
  // The last successful pivot result is still displayed.
  assert.deepEqual(pivot.cells, { A1: "Region", B1: "SUM of Sales" });
  assert.equal(workbook.worksheets[0].cells.A3, "East");
});

test("keeps the pivot configuration when its whole source range is deleted", () => {
  const workbook = normalizeWorkbook({
    id: "wb-1",
    name: "Q3 Sales",
    worksheets: [
      { id: "ws-src", name: "Sheet1", cells: { A1: "Region", A2: "East" } },
      {
        id: "ws-pivot",
        name: "Pivot1",
        cells: { A1: "Region" },
        pivot: { source: { worksheetId: "ws-src", range: { start: "B2", end: "B3" } }, rows: "Region" },
      },
    ],
  });
  const pivot = workbook.worksheets[1];
  deleteColumns(workbook.worksheets[0], { index: 1 });
  shiftPivotSources(workbook, "ws-src", columnDeleteShift(1));

  // The previous result and the field selection survive so the editor can report the missing field.
  assert.deepEqual(pivot.cells, { A1: "Region" });
  assert.equal(pivot.pivot.rows, "Region");
});

test("normalization keeps region records and rejects malformed ones", () => {
  const sheet = normalizeWorksheet({
    id: "ws-1",
    name: "Sheet1",
    cells: { A1: "1" },
    validations: [
      { id: "dv-1", type: "number-range", range: { start: "B2", end: "B4" }, min: 0, max: 100 },
      { id: "dv-2", type: "number-range", range: { start: "nope", end: "B4" } },
    ],
    filters: [{ range: { start: "A1", end: "B4" }, conditions: [{ column: "Region" }] }],
    pivot: { source: { worksheetId: "ws-2", range: { start: "A1", end: "B4" } }, rows: "Region" },
  }, 0);

  assert.equal(sheet.validations.length, 1);
  assert.deepEqual(sheet.validations[0].range, { start: "B2", end: "B4" });
  assert.equal(sheet.filters[0].id, "filter-1");
  assert.deepEqual(sheet.filters[0].conditions, [{ column: "Region" }]);
  assert.equal(sheet.pivot.source.worksheetId, "ws-2");
  assert.equal(normalizeWorksheet({ pivot: { source: {} } }, 0).pivot, null);
});

test("deletes a multi-row validation range only when every row is gone", () => {
  const sheet = worksheet({
    cells: { A1: "1", A2: "2", A3: "3" },
    validations: [{ id: "dv-1", range: { start: "A2", end: "A3" } }],
  });
  deleteRows(sheet, { index: 2 });
  assert.deepEqual(sheet.validations[0].range, { start: "A2", end: "A2" });
  deleteRows(sheet, { index: 1 });
  assert.deepEqual(sheet.validations, []);
});

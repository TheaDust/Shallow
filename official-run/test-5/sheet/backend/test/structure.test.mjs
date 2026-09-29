import test from "node:test";
import assert from "node:assert/strict";

import {
  DELETE_COLUMN,
  DELETE_ROW,
  INSERT_COLUMN_LEFT,
  INSERT_COLUMN_RIGHT,
  INSERT_ROW_ABOVE,
  INSERT_ROW_BELOW,
  REF_ERROR,
  applyColumnOperation,
  applyRowOperation,
} from "../src/domain/structure.mjs";

function worksheet(cells, name = "Sheet1") {
  return { id: "ws-1", name, activeCell: "A1", cells: { ...cells } };
}

const SALES = { A1: "Region", A2: "East", B2: "1200", A3: "North", B3: "800" };

test("inserting a row above shifts the target row and everything after it down", () => {
  const sheet = worksheet(SALES);
  assert.deepEqual(applyRowOperation(sheet, INSERT_ROW_ABOVE, 2), { ok: true });
  assert.deepEqual(sheet.cells, { A1: "Region", A3: "East", B3: "1200", A4: "North", B4: "800" });
});

test("inserting a row below keeps the target row and pushes the following records down", () => {
  const sheet = worksheet(SALES);
  assert.deepEqual(applyRowOperation(sheet, INSERT_ROW_BELOW, 2), { ok: true });
  assert.deepEqual(sheet.cells, { A1: "Region", A2: "East", B2: "1200", A4: "North", B4: "800" });
});

test("deleting a row drops the target record and pulls the following rows up", () => {
  const sheet = worksheet(SALES);
  assert.deepEqual(applyRowOperation(sheet, DELETE_ROW, 2), { ok: true });
  assert.deepEqual(sheet.cells, { A1: "Region", A2: "North", B2: "800" });
});

test("column operations shift and drop whole columns, keeping the other columns", () => {
  const left = worksheet(SALES);
  applyColumnOperation(left, INSERT_COLUMN_LEFT, 2);
  assert.deepEqual(left.cells, { A1: "Region", A2: "East", C2: "1200", A3: "North", C3: "800" });

  const right = worksheet(SALES);
  applyColumnOperation(right, INSERT_COLUMN_RIGHT, 1);
  assert.deepEqual(right.cells, { A1: "Region", A2: "East", C2: "1200", A3: "North", C3: "800" });

  const deleted = worksheet(SALES);
  applyColumnOperation(deleted, DELETE_COLUMN, 1);
  assert.deepEqual(deleted.cells, { A2: "1200", A3: "800" });
});

test("formula references follow the shifted rows and columns", () => {
  const sheet = worksheet({ A1: "1", A2: "2", A3: "3", B1: "=A1+A2", B2: "=SUM(A1:A3)", B3: "=$A$2*2" });
  applyRowOperation(sheet, INSERT_ROW_ABOVE, 1);
  assert.equal(sheet.cells.B2, "=A2+A3");
  assert.equal(sheet.cells.B3, "=SUM(A2:A4)");
  assert.equal(sheet.cells.B4, "=$A$3*2");


  const columns = worksheet({ A1: "1", B1: "2", C1: "=A1+B1", D1: "=SUM(A1:B1)" });
  applyColumnOperation(columns, INSERT_COLUMN_LEFT, 1);
  assert.equal(columns.cells.D1, "=B1+C1");
  assert.equal(columns.cells.E1, "=SUM(B1:C1)");
});

test("references to a deleted row or column become #REF! while ranges shrink", () => {
  const rows = worksheet({
    A1: "1", A2: "2", A3: "3", A4: "4",
    C1: "=A2+1", D1: "=SUM(A1:A3)", C3: "=A1", C4: "=SUM(A2:A4)", E2: "=SUM(A2:A2)",
  });
  applyRowOperation(rows, DELETE_ROW, 2);
  assert.equal(rows.cells.C1, `=${REF_ERROR}+1`);
  assert.equal(rows.cells.D1, "=SUM(A1:A2)");
  assert.equal(rows.cells.C2, "=A1");
  assert.equal(rows.cells.C3, "=SUM(A2:A3)");
  // the deleted row takes its own formulas with it
  assert.equal(rows.cells.E2, undefined);

  const columns = worksheet({ A1: "1", B1: "2", C1: "=A1", D1: "=B1", E1: "=SUM(A1:B1)" });
  applyColumnOperation(columns, DELETE_COLUMN, 1);
  assert.equal(columns.cells.B1, `=${REF_ERROR}`);
  assert.equal(columns.cells.C1, "=A1");
  assert.equal(columns.cells.D1, "=SUM(A1:A1)");
});

test("formula rewriting keeps quoted literals and other worksheets untouched", () => {
  const sheet = worksheet({ A1: "=CONCAT(\"A1\",A1)", B1: "=Sheet2!A2" }, "Sheet1");
  applyRowOperation(sheet, INSERT_ROW_ABOVE, 1);
  assert.equal(sheet.cells.A2, "=CONCAT(\"A1\",A2)");
  assert.equal(sheet.cells.B2, "=Sheet2!A2");
});

test("values pushed past the last row or column leave the grid", () => {
  const sheet = worksheet({ A40: "last" });
  applyRowOperation(sheet, INSERT_ROW_ABOVE, 1);
  assert.deepEqual(sheet.cells, {});

  const columns = worksheet({ T1: "last" });
  applyColumnOperation(columns, INSERT_COLUMN_LEFT, 1);
  assert.deepEqual(columns.cells, {});
});

test("rejected operations leave the worksheet untouched", () => {
  const sheet = worksheet(SALES);
  assert.equal(applyRowOperation(sheet, "insert-row", 2).ok, false);
  assert.equal(applyRowOperation(sheet, INSERT_ROW_ABOVE, 0).ok, false);
  assert.equal(applyRowOperation(sheet, DELETE_ROW, 41).ok, false);
  assert.equal(applyColumnOperation(sheet, "delete-col", 1).ok, false);
  assert.equal(applyColumnOperation(sheet, DELETE_COLUMN, 21).ok, false);
  assert.equal(applyColumnOperation(sheet, DELETE_COLUMN, 1.5).ok, false);
  assert.deepEqual(sheet.cells, SALES);
});

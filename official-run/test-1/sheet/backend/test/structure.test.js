import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROW_ACTIONS,
  shiftRowNumber,
  shiftCells,
  adjustCellRefs,
  shiftCoordinateRow,
} from "../src/structure.js";
import {
  COLUMN_ACTIONS,
  shiftColumnNumber,
  shiftColumnLabel,
  shiftCellsColumn,
  adjustCellRefsColumn,
  shiftCoordinateColumn,
} from "../src/structure.js";

test("ROW_ACTIONS lists the supported row operations", () => {
  assert.deepEqual(ROW_ACTIONS, ["insert-above", "insert-below", "delete"]);
});

test("shiftRowNumber moves rows for insert-above / insert-below / delete", () => {
  // insert-above: rows >= target move down one
  assert.equal(shiftRowNumber(2, "insert-above", 2), 3);
  assert.equal(shiftRowNumber(1, "insert-above", 2), 1);
  assert.equal(shiftRowNumber(5, "insert-above", 2), 6);
  // insert-below: rows > target move down one
  assert.equal(shiftRowNumber(2, "insert-below", 2), 2);
  assert.equal(shiftRowNumber(3, "insert-below", 2), 4);
  assert.equal(shiftRowNumber(1, "insert-below", 2), 1);
  // delete: target row is removed; rows above stay; rows below move up
  assert.equal(shiftRowNumber(3, "delete", 2), 2);
  assert.equal(shiftRowNumber(1, "delete", 2), 1);
  assert.equal(shiftRowNumber(2, "delete", 2), "#REF!");
});

test("shiftCells shifts the seeded grid rows together on insertion", () => {
  const cells = { A1: "Region", A2: "East", B2: "1200", A3: "North", B3: "800" };
  const above = shiftCells(cells, "insert-above", 2);
  assert.deepEqual(above.cells, { A1: "Region", A3: "East", B3: "1200", A4: "North", B4: "800" });
  assert.equal(above.maxRow, 4);

  const below = shiftCells(cells, "insert-below", 2);
  assert.deepEqual(below.cells, { A1: "Region", A2: "East", B2: "1200", A4: "North", B4: "800" });
  assert.equal(below.maxRow, 4);
});

test("shiftCells removes the deleted row and shifts later rows up", () => {
  const cells = { A1: "Region", A2: "East", B2: "1200", A3: "North", B3: "800" };
  const del = shiftCells(cells, "delete", 2);
  assert.deepEqual(del.cells, { A1: "Region", A2: "North", B2: "800" });
  assert.equal(del.maxRow, 2);
});

test("shiftCells with an empty or unrelated operation leaves data intact", () => {
  assert.deepEqual(shiftCells({}, "insert-above", 1), { cells: {}, maxRow: 0 });
  const cells = { A1: "x" };
  const below = shiftCells(cells, "insert-below", 5);
  assert.deepEqual(below.cells, { A1: "x" });
  assert.equal(below.maxRow, 1);
});

test("adjustCellRefs adjusts formula references and turns deleted-row references into #REF!", () => {
  // insert above row 2: refs on rows >= 2 move down one
  assert.equal(adjustCellRefs("=B2+C3", "insert-above", 2), "=B3+C4");
  assert.equal(adjustCellRefs("=SUM(B2:C3)", "insert-above", 2), "=SUM(B3:C4)");
  // insert below row 2: refs on rows > 2 move down one
  assert.equal(adjustCellRefs("=B2+C3", "insert-below", 2), "=B2+C4");
  // delete row 1: refs to row 1 cannot be preserved
  assert.equal(adjustCellRefs("=A1+B2", "delete", 1), "=#REF!+B1");
  assert.equal(adjustCellRefs("=A2", "delete", 1), "=A1");
  // plain values (no leading "=") are handled by the caller, not here
  assert.equal(adjustCellRefs("see A1", "insert-above", 1), "see A2");
});

test("shiftCells adjusts formula text in shifted cells", () => {
  const cells = { A1: "=B2", A2: "=SUM(B2:C3)", B1: "5" };
  const above = shiftCells(cells, "insert-above", 2);
  assert.equal(above.cells.A1, "=B3"); // cell stays on row 1, its reference moves
  assert.equal(above.cells.A3, "=SUM(B3:C4)"); // cell A2 moved to A3, refs move with it
  assert.equal(above.cells.B1, "5");

  const del = shiftCells({ A2: "=A1", B1: "x" }, "delete", 1);
  assert.deepEqual(del.cells, { A1: "=#REF!" });
});

test("shiftCoordinateRow keeps the row of a coordinate or moves it with the shift", () => {
  assert.equal(shiftCoordinateRow("A2", "insert-above", 2), "A3");
  assert.equal(shiftCoordinateRow("A1", "insert-above", 2), "A1");
  assert.equal(shiftCoordinateRow("A3", "insert-below", 2), "A4");
  assert.equal(shiftCoordinateRow("A3", "delete", 2), "A2");
  // the deleted row keeps its coordinate (content shifts up into it)
  assert.equal(shiftCoordinateRow("A2", "delete", 2), "A2");
  assert.equal(shiftCoordinateRow("B9", "delete", 3), "B8");
});

test("COLUMN_ACTIONS lists the supported column operations", () => {
  assert.deepEqual(COLUMN_ACTIONS, ["insert-left", "insert-right", "delete"]);
});

test("shiftColumnNumber moves columns for insert-left / insert-right / delete", () => {
  // insert-left: columns >= target move right one
  assert.equal(shiftColumnNumber(2, "insert-left", 2), 3);
  assert.equal(shiftColumnNumber(1, "insert-left", 2), 1);
  assert.equal(shiftColumnNumber(5, "insert-left", 2), 6);
  // insert-right: columns > target move right one
  assert.equal(shiftColumnNumber(2, "insert-right", 2), 2);
  assert.equal(shiftColumnNumber(3, "insert-right", 2), 4);
  assert.equal(shiftColumnNumber(1, "insert-right", 2), 1);
  // delete: the target column is removed; columns above stay; columns below move left
  assert.equal(shiftColumnNumber(3, "delete", 2), 2);
  assert.equal(shiftColumnNumber(1, "delete", 2), 1);
  assert.equal(shiftColumnNumber(2, "delete", 2), "#REF!");
});

test("shiftColumnLabel maps column labels across the shift", () => {
  assert.equal(shiftColumnLabel("B", "insert-left", 2), "C");
  assert.equal(shiftColumnLabel("A", "insert-left", 2), "A");
  assert.equal(shiftColumnLabel("C", "insert-right", 2), "D");
  assert.equal(shiftColumnLabel("C", "delete", 2), "B");
  assert.equal(shiftColumnLabel("B", "delete", 2), "#REF!");
  assert.equal(shiftColumnLabel("Z", "insert-left", 2), "AA");
});

test("shiftCellsColumn shifts the seeded grid columns on insertion", () => {
  const cells = { A1: "Region", A2: "East", B2: "1200", A3: "North", B3: "800" };
  // insert left of B: column A stays put, B and later columns move right
  const left = shiftCellsColumn(cells, "insert-left", 2);
  assert.deepEqual(left.cells, { A1: "Region", A2: "East", C2: "1200", A3: "North", C3: "800" });
  assert.equal(left.maxCol, 3);

  // insert right of B: columns after B move right (no data there yet)
  const right = shiftCellsColumn(cells, "insert-right", 2);
  assert.deepEqual(right.cells, { A1: "Region", A2: "East", B2: "1200", A3: "North", B3: "800" });
  assert.equal(right.maxCol, 2);
});

test("shiftCellsColumn removes the deleted column and shifts later columns left", () => {
  const cells = { A1: "Region", A2: "East", B2: "1200", A3: "North", B3: "800" };
  // deleting column B removes 1200/800 (they lived in column B)
  const del = shiftCellsColumn(cells, "delete", 2);
  assert.deepEqual(del.cells, { A1: "Region", A2: "East", A3: "North" });
  assert.equal(del.maxCol, 1);
  // data in a later column shifts left into the deleted column's place
  const delLater = shiftCellsColumn({ A1: "x", C1: "y" }, "delete", 2);
  assert.deepEqual(delLater.cells, { A1: "x", B1: "y" });
  assert.equal(delLater.maxCol, 2);
  // deleting column A removes the label column as well
  const delA = shiftCellsColumn(cells, "delete", 1);
  assert.deepEqual(delA.cells, { A2: "1200", A3: "800" });
  assert.equal(delA.maxCol, 1);
});

test("shiftCellsColumn with an empty or unrelated operation leaves data intact", () => {
  assert.deepEqual(shiftCellsColumn({}, "insert-left", 1), { cells: {}, maxCol: 0 });
  const cells = { A1: "x" };
  const right = shiftCellsColumn(cells, "insert-right", 5);
  assert.deepEqual(right.cells, { A1: "x" });
  assert.equal(right.maxCol, 1);
});

test("adjustCellRefsColumn adjusts formula references and turns deleted-column references into #REF!", () => {
  // insert left of column B: refs on columns >= B move right one
  assert.equal(adjustCellRefsColumn("=B2+C3", "insert-left", 2), "=C2+D3");
  assert.equal(adjustCellRefsColumn("=SUM(B2:C3)", "insert-left", 2), "=SUM(C2:D3)");
  // insert right of column B: refs on columns > B move right one
  assert.equal(adjustCellRefsColumn("=B2+C3", "insert-right", 2), "=B2+D3");
  // delete column A: refs to column A cannot be preserved
  assert.equal(adjustCellRefsColumn("=A1+B2", "delete", 1), "=#REF!+A2");
  assert.equal(adjustCellRefsColumn("=B2", "delete", 1), "=A2");
  // plain values (no leading "=") are handled by the caller, not here
  assert.equal(adjustCellRefsColumn("see B1", "insert-left", 1), "see C1");
});

test("shiftCellsColumn adjusts formula text in shifted cells", () => {
  const cells = { A1: "=B2", B2: "=SUM(B2:C3)", C1: "5" };
  const left = shiftCellsColumn(cells, "insert-left", 2);
  assert.equal(left.cells.A1, "=C2"); // cell stays on column A, its reference moves
  assert.equal(left.cells.C2, "=SUM(C2:D3)"); // cell B2 moved to C2, refs move with it
  assert.equal(left.cells.D1, "5");

  const del = shiftCellsColumn({ B2: "=A1", A1: "x" }, "delete", 1);
  assert.deepEqual(del.cells, { A2: "=#REF!" });
});

test("shiftCoordinateColumn keeps the column of a coordinate or moves it with the shift", () => {
  assert.equal(shiftCoordinateColumn("B2", "insert-left", 2), "C2");
  assert.equal(shiftCoordinateColumn("A1", "insert-left", 2), "A1");
  assert.equal(shiftCoordinateColumn("C3", "insert-right", 2), "D3");
  assert.equal(shiftCoordinateColumn("C3", "delete", 2), "B3");
  // the deleted column keeps its coordinate (content shifts left into it)
  assert.equal(shiftCoordinateColumn("B2", "delete", 2), "B2");
});

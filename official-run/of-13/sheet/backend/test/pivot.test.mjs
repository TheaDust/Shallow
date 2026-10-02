/**
 * REQ-5-3-1: the pivot summary itself — ordering, grand totals, the three methods and the two
 * contract refusals. `computePivotCells` only reads the source worksheet, so these tests also
 * pin that the source cells are never touched.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  computePivotCells,
  PIVOT_FIELD_MISSING_MESSAGE,
  PIVOT_NUMERIC_MESSAGE,
  shiftPivotSourceRange,
} from "../src/domain/pivot.mjs";

/** The seeded data region: headers `Region/Sales/Status` over three records. */
function seededSource() {
  return {
    id: "wb-q3-sales-sheet-1",
    name: "Sheet1",
    cells: {
      A1: "Region",
      B1: "Sales",
      C1: "Status",
      A2: "East",
      B2: "1200",
      C2: "Open",
      A3: "North",
      B3: "800",
      C3: "Closed",
      A4: "South",
      B4: "700",
      C4: "Open",
    },
  };
}

function config(overrides = {}) {
  return {
    sourceSheetId: "wb-q3-sales-sheet-1",
    sourceRange: "A1:C4",
    rowField: "Region",
    columnField: "",
    valueField: "Sales",
    method: "SUM",
    ...overrides,
  };
}

test("a single row field produces the header row, first-appearance groups and a grand total", () => {
  const source = seededSource();
  const before = structuredClone(source.cells);
  const result = computePivotCells({ sourceSheet: source, config: config() });
  assert.equal(result.ok, true);
  assert.deepEqual(result.cells, {
    A1: "Region",
    B1: "SUM of Sales",
    A2: "East",
    B2: "1200",
    A3: "North",
    B3: "800",
    A4: "South",
    B4: "700",
    A5: "Grand Total",
    B5: "2700",
  });
  // The pivot only reads: the source worksheet is byte-for-byte the same afterwards.
  assert.deepEqual(source.cells, before);
});

test("AVERAGE divides by the parseable numbers and COUNT counts non-empty records", () => {
  const average = computePivotCells({
    sourceSheet: seededSource(),
    config: config({ method: "AVERAGE" }),
  });
  assert.equal(average.ok, true);
  assert.equal(average.cells.B1, "AVERAGE of Sales");
  assert.equal(average.cells.B2, "1200");
  assert.equal(average.cells.B5, "900");

  const counted = computePivotCells({
    sourceSheet: seededSource(),
    config: config({ method: "COUNT" }),
  });
  assert.equal(counted.ok, true);
  assert.equal(counted.cells.B1, "COUNT of Sales");
  assert.equal(counted.cells.B5, "3");
});

test("a column field lays out its values and a Grand Total column and row", () => {
  const result = computePivotCells({
    sourceSheet: seededSource(),
    config: config({ columnField: "Status" }),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.cells, {
    A1: "Region",
    B1: "Open",
    C1: "Closed",
    D1: "Grand Total",
    A2: "East",
    B2: "1200",
    C2: "0",
    D2: "1200",
    A3: "North",
    B3: "0",
    C3: "800",
    D3: "800",
    A4: "South",
    B4: "700",
    C4: "0",
    D4: "700",
    A5: "Grand Total",
    B5: "1900",
    C5: "800",
    D5: "2700",
  });
});

test("COUNT reports 0 for an empty row/column combination and survives text values", () => {
  const source = seededSource();
  source.cells.B2 = "unknown";
  const result = computePivotCells({
    sourceSheet: source,
    config: config({ columnField: "Status", method: "COUNT" }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.cells.B2, "1");
  assert.equal(result.cells.C2, "0");
  assert.equal(result.cells.B4, "1");
  assert.equal(result.cells.D5, "3");
});

test("SUM and AVERAGE refuse a value field without parseable numbers", () => {
  const source = seededSource();
  source.cells.B2 = "unknown";
  source.cells.B3 = "unknown";
  source.cells.B4 = "unknown";
  const before = structuredClone(source.cells);
  for (const method of ["SUM", "AVERAGE"]) {
    const result = computePivotCells({ sourceSheet: source, config: config({ method }) });
    assert.equal(result.ok, false);
    assert.equal(result.error, PIVOT_NUMERIC_MESSAGE);
  }
  assert.deepEqual(source.cells, before);
});

test("a deleted header reports the field as unavailable", () => {
  const result = computePivotCells({
    sourceSheet: seededSource(),
    config: config({ rowField: "Area" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, PIVOT_FIELD_MISSING_MESSAGE);

  const column = computePivotCells({
    sourceSheet: seededSource(),
    config: config({ columnField: "Quarter" }),
  });
  assert.equal(column.ok, false);
  assert.equal(column.error, PIVOT_FIELD_MISSING_MESSAGE);
});

test("a source range follows a row insertion so a later refresh reads the moved band", () => {
  const change = { axis: "row", action: "insert-above", index: 3 };
  assert.equal(shiftPivotSourceRange("A1:C4", change), "A1:C5");
  assert.equal(
    shiftPivotSourceRange("A1:C4", { axis: "column", action: "insert-left", index: 2 }),
    "A1:D4",
  );
  assert.equal(
    shiftPivotSourceRange("A1:C4", { axis: "row", action: "delete", index: 2 }),
    "A1:C3",
  );
});

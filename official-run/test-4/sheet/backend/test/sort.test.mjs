import assert from "node:assert/strict";
import test from "node:test";

import { cellName, compareValues, parseCoord, parseDate, sortRangeCells } from "../src/lib/sort.mjs";

test("compares numbers, dates, and text by type", () => {
  assert.equal(compareValues("1200", "800") > 0, true);
  assert.equal(compareValues("800", "1200") < 0, true);
  assert.equal(compareValues("East", "North") < 0, true);
  assert.equal(compareValues("North", "East") > 0, true);
  assert.equal(compareValues("2024-01-05", "2024-03-01") < 0, true);
  assert.equal(compareValues("2024-03-01", "2024-01-05") > 0, true);
  // numbers sort before dates before text within one column
  assert.equal(compareValues("1200", "East") < 0, true);
  assert.equal(compareValues("2024-01-05", "East") < 0, true);
  assert.equal(compareValues("East", "2024-01-05") > 0, true);
  // equal keys compare equal (stable sort)
  assert.equal(compareValues("800", "800"), 0);
  assert.equal(compareValues("East", "East"), 0);
});

test("parseDate accepts ISO, slashed, dotted, and american dates", () => {
  assert.equal(parseDate("2024-01-05"), Date.UTC(2024, 0, 5));
  assert.equal(parseDate("2024/03/01"), Date.UTC(2024, 2, 1));
  assert.equal(parseDate("2024.03.01"), Date.UTC(2024, 2, 1));
  assert.equal(parseDate("01/05/2024"), Date.UTC(2024, 0, 5));
  assert.equal(parseDate("East"), null);
  assert.equal(parseDate(""), null);
});

function setCells(entries) {
  return Object.fromEntries(entries.map(([coord, value]) => [coord, value]));
}

test("sorts the seeded A1:C4 rectangle by Sales ascending with a header row", () => {
  const cells = setCells([
    ["A1", "Region"],
    ["B1", "Sales"],
    ["C1", "Status"],
    ["A2", "East"],
    ["B2", "1200"],
    ["C2", "Open"],
    ["A3", "North"],
    ["B3", "800"],
    ["C3", "Closed"],
    ["A4", "South"],
    ["B4", "700"],
    ["C4", "Open"],
    ["A5", "outside"],
    ["D5", "untouched"],
  ]);
  const sorted = sortRangeCells(cells, { start: "A1", end: "C4" }, "B", "ascending", true);
  // header row stays put
  assert.equal(sorted.A1, "Region");
  assert.equal(sorted.B1, "Sales");
  // rows 2..4 reordered by Sales ascending: 700 South, 800 North, 1200 East
  assert.equal(sorted.A2, "South");
  assert.equal(sorted.B2, "700");
  assert.equal(sorted.C2, "Open");
  assert.equal(sorted.A3, "North");
  assert.equal(sorted.B3, "800");
  assert.equal(sorted.C3, "Closed");
  assert.equal(sorted.A4, "East");
  assert.equal(sorted.B4, "1200");
  assert.equal(sorted.C4, "Open");
  // data outside the selection is untouched
  assert.equal(sorted.A5, "outside");
  assert.equal(sorted.D5, "untouched");
  // the input cells map is not mutated
  assert.equal(cells.A2, "East");
});

test("sorts descending and moves whole records together", () => {
  const cells = setCells([
    ["A1", "Region"],
    ["B1", "Sales"],
    ["C1", "Status"],
    ["A2", "East"],
    ["B2", "1200"],
    ["C2", "Open"],
    ["A3", "North"],
    ["B3", "800"],
    ["C3", "Closed"],
    ["A4", "South"],
    ["B4", "700"],
    ["C4", "Open"],
  ]);
  const sorted = sortRangeCells(cells, { start: "A1", end: "C4" }, "B", "descending", true);
  assert.equal(sorted.A2, "East");
  assert.equal(sorted.C2, "Open");
  assert.equal(sorted.A3, "North");
  assert.equal(sorted.A4, "South");
  assert.equal(sorted.B4, "700");
  assert.equal(sorted.C4, "Open");
});

test("equal sort keys preserve their original relative order (stable)", () => {
  const cells = setCells([
    ["A1", "Region"],
    ["B1", "Sales"],
    ["A2", "First"],
    ["B2", "500"],
    ["A3", "Second"],
    ["B3", "500"],
    ["A4", "Third"],
    ["B4", "500"],
  ]);
  const sorted = sortRangeCells(cells, { start: "A1", end: "B4" }, "B", "ascending", true);
  assert.equal(sorted.A2, "First");
  assert.equal(sorted.A3, "Second");
  assert.equal(sorted.A4, "Third");
  const descending = sortRangeCells(cells, { start: "A1", end: "B4" }, "B", "descending", true);
  assert.equal(descending.A2, "First");
  assert.equal(descending.A3, "Second");
  assert.equal(descending.A4, "Third");
});

test("without a header row the first row participates in sorting", () => {
  const cells = setCells([
    ["A1", "East"],
    ["B1", "1200"],
    ["A2", "North"],
    ["B2", "800"],
    ["A3", "South"],
    ["B3", "700"],
  ]);
  const sorted = sortRangeCells(cells, { start: "A1", end: "B3" }, "B", "ascending", false);
  assert.equal(sorted.A1, "South");
  assert.equal(sorted.A2, "North");
  assert.equal(sorted.A3, "East");
  assert.equal(sorted.B1, "700");
  assert.equal(sorted.B3, "1200");
});

test("sorts text columns case-insensitively", () => {
  const cells = setCells([
    ["A1", "Region"],
    ["B1", "Sales"],
    ["A2", "East"],
    ["B2", "1"],
    ["A3", "north"],
    ["B3", "2"],
    ["A4", "south"],
    ["B4", "3"],
  ]);
  const sorted = sortRangeCells(cells, { start: "A1", end: "B4" }, "A", "ascending", true);
  assert.equal(sorted.A2, "East");
  assert.equal(sorted.A3, "north");
  assert.equal(sorted.A4, "south");
});

test("sorts dates by their chronological value", () => {
  const cells = setCells([
    ["A1", "Date"],
    ["B1", "Note"],
    ["A2", "2024-03-01"],
    ["B2", "x"],
    ["A3", "2024-01-05"],
    ["B3", "y"],
    ["A4", "2023-12-31"],
    ["B4", "z"],
  ]);
  const sorted = sortRangeCells(cells, { start: "A1", end: "B4" }, "A", "ascending", true);
  assert.equal(sorted.A2, "2023-12-31");
  assert.equal(sorted.A3, "2024-01-05");
  assert.equal(sorted.A4, "2024-03-01");
});

test("blank sort keys always sort last", () => {
  const cells = setCells([
    ["A1", "Region"],
    ["B1", "Sales"],
    ["A2", "East"],
    ["B2", "1200"],
    ["A3", "North"],
    ["B3", "800"],
    ["A4", "South"],
    ["B4", "700"],
    ["A5", ""],
    ["B5", ""],
  ]);
  const ascending = sortRangeCells(cells, { start: "A1", end: "C5" }, "B", "ascending", true);
  assert.equal(ascending.A2, "South");
  assert.equal(ascending.A4, "East");
  assert.equal(ascending.A5, undefined);
  assert.equal(ascending.B5, undefined);
  const descending = sortRangeCells(cells, { start: "A1", end: "C5" }, "B", "descending", true);
  assert.equal(descending.A2, "East");
  assert.equal(descending.A4, "South");
  assert.equal(descending.A5, undefined);
  assert.equal(descending.B5, undefined);
});

test("formula text moves with its row and references stay relative", () => {
  const cells = setCells([
    ["A1", "Region"],
    ["B1", "Sales"],
    ["C1", "Total"],
    ["A2", "East"],
    ["B2", "1200"],
    ["C2", "=A2&\"!\"&B2"],
    ["A3", "North"],
    ["B3", "800"],
    ["C3", "=A3&\"!\"&B3"],
    ["A4", "South"],
    ["B4", "700"],
    ["C4", "=A4&\"!\"&B4"],
  ]);
  const sorted = sortRangeCells(cells, { start: "A1", end: "C4" }, "B", "ascending", true);
  // South (orig row 4) moves to row 2; its formula text moves with the row
  assert.equal(sorted.C2, "=A4&\"!\"&B4");
  assert.equal(sorted.C3, "=A3&\"!\"&B3");
  assert.equal(sorted.C4, "=A2&\"!\"&B2");
  assert.equal(sorted.A2, "South");
});

test("sorts a single column range and a single row", () => {
  const cells = setCells([
    ["A1", "3"],
    ["A2", "1"],
    ["A3", "2"],
  ]);
  const sorted = sortRangeCells(cells, { start: "A1", end: "A3" }, "A", "ascending", false);
  assert.equal(sorted.A1, "1");
  assert.equal(sorted.A2, "2");
  assert.equal(sorted.A3, "3");
  // a single-row range keeps that row (no data rows to reorder)
  const oneRow = sortRangeCells(cells, { start: "A1", end: "C1" }, "A", "ascending", false);
  assert.equal(oneRow.A1, "3");
});

test("rejects a sort column outside the range and invalid orders", () => {
  const cells = setCells([["A1", "x"], ["B1", "y"]]);
  assert.throws(
    () => sortRangeCells(cells, { start: "A1", end: "B2" }, "C", "ascending", true),
    /Sort column outside range/,
  );
  assert.throws(
    () => sortRangeCells(cells, { start: "A1", end: "B2" }, "A", "sideways", true),
    /Invalid sort order/,
  );
});

test("normalizes a reversed range before sorting", () => {
  const cells = setCells([
    ["A1", "East"],
    ["B1", "1200"],
    ["A2", "North"],
    ["B2", "800"],
    ["A3", "South"],
    ["B3", "700"],
  ]);
  const sorted = sortRangeCells(cells, { start: "B3", end: "A1" }, "B", "ascending", false);
  assert.equal(sorted.A1, "South");
  assert.equal(sorted.A2, "North");
  assert.equal(sorted.A3, "East");
});

test("coordinate helpers stay consistent", () => {
  assert.deepEqual(parseCoord("B2"), { row: 2, col: 1 });
  assert.equal(cellName(2, 1), "B2");
});

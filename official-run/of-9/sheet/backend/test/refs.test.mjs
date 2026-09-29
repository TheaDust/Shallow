import assert from "node:assert/strict";
import test from "node:test";

import {
  columnIndex,
  columnLabel,
  parseCoordinate,
  rewriteFormulaReferences,
  shiftCells,
  shiftRange,
} from "../src/lib/refs.mjs";

test("coordinate helpers round-trip labels and coordinates", () => {
  assert.equal(columnLabel(0), "A");
  assert.equal(columnLabel(25), "Z");
  assert.equal(columnLabel(26), "AA");
  assert.equal(columnIndex("A"), 1);
  assert.equal(columnIndex("Z"), 26);
  assert.equal(columnIndex("AA"), 27);
  assert.deepEqual(parseCoordinate("AB12"), { row: 12, column: 28 });
  assert.equal(parseCoordinate("12A"), null);
  assert.equal(parseCoordinate(""), null);
});

test("rewrites single references when inserting a row above", () => {
  assert.equal(rewriteFormulaReferences("=A1+A5", { type: "insert-row-above", at: 3 }), "=A1+A6");
  assert.equal(rewriteFormulaReferences("=A3", { type: "insert-row-above", at: 3 }), "=A4");
  assert.equal(rewriteFormulaReferences("=A2", { type: "insert-row-above", at: 3 }), "=A2");
});

test("rewrites single references when inserting a row below", () => {
  assert.equal(rewriteFormulaReferences("=A5", { type: "insert-row-below", at: 3 }), "=A6");
  assert.equal(rewriteFormulaReferences("=A3", { type: "insert-row-below", at: 3 }), "=A3");
});

test("rewrites ranges when inserting rows", () => {
  assert.equal(rewriteFormulaReferences("=SUM(A2:A3)", { type: "insert-row-above", at: 2 }), "=SUM(A3:A4)");
  assert.equal(rewriteFormulaReferences("=SUM(A1:A3)", { type: "insert-row-above", at: 2 }), "=SUM(A1:A4)");
  assert.equal(rewriteFormulaReferences("=SUM(A2:A3)", { type: "insert-row-below", at: 2 }), "=SUM(A2:A4)");
  assert.equal(rewriteFormulaReferences("=SUM(A3:A4)", { type: "insert-row-below", at: 2 }), "=SUM(A4:A5)");
});

test("rewrites single references when deleting a row and marks broken ones", () => {
  assert.equal(rewriteFormulaReferences("=A1+A5", { type: "delete-row", at: 3 }), "=A1+A4");
  assert.equal(rewriteFormulaReferences("=A3", { type: "delete-row", at: 3 }), "=#REF!");
  assert.equal(rewriteFormulaReferences("=A3+B4", { type: "delete-row", at: 3 }), "=#REF!+B3");
});

test("rewrites ranges when deleting a row", () => {
  assert.equal(rewriteFormulaReferences("=SUM(A1:A5)", { type: "delete-row", at: 3 }), "=SUM(A1:A4)");
  assert.equal(rewriteFormulaReferences("=SUM(A3:A5)", { type: "delete-row", at: 3 }), "=SUM(A3:A4)");
  assert.equal(rewriteFormulaReferences("=SUM(A1:A3)", { type: "delete-row", at: 3 }), "=SUM(A1:A2)");
  assert.equal(rewriteFormulaReferences("=SUM(A3:A3)", { type: "delete-row", at: 3 }), "=SUM(#REF!)");
  assert.equal(rewriteFormulaReferences("=SUM(A2:A4)", { type: "delete-row", at: 1 }), "=SUM(A1:A3)");
});

test("rewrites references when inserting columns", () => {
  assert.equal(rewriteFormulaReferences("=B1+C1", { type: "insert-column-left", at: 2 }), "=C1+D1");
  assert.equal(rewriteFormulaReferences("=A1+C1", { type: "insert-column-left", at: 2 }), "=A1+D1");
  assert.equal(rewriteFormulaReferences("=SUM(B1:C1)", { type: "insert-column-left", at: 2 }), "=SUM(C1:D1)");
  assert.equal(rewriteFormulaReferences("=SUM(A1:B1)", { type: "insert-column-left", at: 2 }), "=SUM(A1:C1)");
  assert.equal(rewriteFormulaReferences("=B1", { type: "insert-column-right", at: 2 }), "=B1");
  assert.equal(rewriteFormulaReferences("=C1", { type: "insert-column-right", at: 2 }), "=D1");
  assert.equal(rewriteFormulaReferences("=SUM(A1:C1)", { type: "insert-column-right", at: 2 }), "=SUM(A1:D1)");
});

test("rewrites references when deleting columns and marks broken ones", () => {
  assert.equal(rewriteFormulaReferences("=A1+C1", { type: "delete-column", at: 2 }), "=A1+B1");
  assert.equal(rewriteFormulaReferences("=B1", { type: "delete-column", at: 2 }), "=#REF!");
  assert.equal(rewriteFormulaReferences("=B1+C1", { type: "delete-column", at: 2 }), "=#REF!+B1");
  assert.equal(rewriteFormulaReferences("=SUM(B1:C1)", { type: "delete-column", at: 2 }), "=SUM(B1:B1)");
  assert.equal(rewriteFormulaReferences("=SUM(A1:B1)", { type: "delete-column", at: 2 }), "=SUM(A1:A1)");
  assert.equal(rewriteFormulaReferences("=SUM(B1:B1)", { type: "delete-column", at: 2 }), "=SUM(#REF!)");
  assert.equal(rewriteFormulaReferences("=SUM(C1:E1)", { type: "delete-column", at: 2 }), "=SUM(B1:D1)");
});

test("preserves absolute references, sheet prefixes and column letters beyond Z", () => {
  assert.equal(rewriteFormulaReferences("=$A$1+$B2", { type: "insert-row-above", at: 2 }), "=$A$1+$B3");
  assert.equal(rewriteFormulaReferences("=Sheet2!A1+AA5", { type: "insert-row-above", at: 2 }), "=Sheet2!A1+AA6");
  assert.equal(rewriteFormulaReferences("=AB5", { type: "delete-row", at: 3 }), "=AB4");
  assert.equal(rewriteFormulaReferences("=AA1", { type: "delete-column", at: 2 }), "=Z1");
  assert.equal(rewriteFormulaReferences("=SUM(A1:AA2)", { type: "insert-column-left", at: 2 }), "=SUM(A1:AB2)");
});

test("shiftCells moves cells and drops deleted rows or columns", () => {
  const cells = { A1: { value: "a" }, A2: { value: "b" }, B2: { value: "c" } };
  assert.deepEqual(shiftCells(cells, { type: "insert-row-above", at: 2 }), {
    A1: { value: "a" },
    A3: { value: "b" },
    B3: { value: "c" },
  });
  assert.deepEqual(shiftCells(cells, { type: "delete-row", at: 1 }), {
    A1: { value: "b" },
    B1: { value: "c" },
  });
  assert.deepEqual(shiftCells(cells, { type: "insert-column-left", at: 2 }), {
    A1: { value: "a" },
    A2: { value: "b" },
    C2: { value: "c" },
  });
  assert.deepEqual(shiftCells(cells, { type: "delete-column", at: 2 }), {
    A1: { value: "a" },
    A2: { value: "b" },
  });
});

test("shiftRange shifts endpoints and collapses deleted ranges", () => {
  const range = { start: { row: 1, column: 1 }, end: { row: 3, column: 2 } };
  assert.deepEqual(shiftRange(range, { type: "insert-row-above", at: 2 }), {
    start: { row: 1, column: 1 },
    end: { row: 4, column: 2 },
  });
  assert.deepEqual(shiftRange(range, { type: "delete-row", at: 2 }), {
    start: { row: 1, column: 1 },
    end: { row: 2, column: 2 },
  });
  assert.equal(shiftRange({ start: { row: 2, column: 1 }, end: { row: 2, column: 2 } }, { type: "delete-row", at: 2 }), null);
  assert.deepEqual(shiftRange(range, { type: "delete-column", at: 1 }), {
    start: { row: 1, column: 1 },
    end: { row: 3, column: 1 },
  });
});

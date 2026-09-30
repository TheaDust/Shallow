import assert from "node:assert/strict";
import test from "node:test";

import { computeWorksheetCells, remapFormulaReferences, translateFormulaReferences } from "../src/lib/formula.mjs";

function displays(cells) {
  const computed = computeWorksheetCells(cells);
  return Object.fromEntries(Object.entries(computed).map(([cellId, cell]) => [cellId, cell.display]));
}

test("keeps the submitted text as the cell value and recalculates formulas", () => {
  const computed = computeWorksheetCells({
    A1: { value: "2" },
    B1: { value: "3" },
    C1: { value: "=A1+B1" },
    D1: { value: "=C1*2" },
  });

  assert.equal(computed.C1.value, "=A1+B1");
  assert.equal(computed.C1.display, "5");
  assert.equal(computed.D1.display, "10");
  assert.deepEqual(computed.A1, { value: "2", display: "2" });
});

test("recalculates directly and indirectly dependent formulas in dependency order", () => {
  const before = displays({ A1: { value: "1" }, B1: { value: "=A1+1" }, C1: { value: "=B1*10" } });
  assert.equal(before.C1, "20");

  const after = displays({ A1: { value: "4" }, B1: { value: "=A1+1" }, C1: { value: "=B1*10" } });
  assert.equal(after.B1, "5");
  assert.equal(after.C1, "50");
});

test("supports text, numbers, booleans, date text and absolute references", () => {
  const result = displays({
    A1: { value: "2026-09-29" },
    A2: { value: "TRUE" },
    A3: { value: "Region" },
    B1: { value: "=$A$3" },
    B2: { value: "=A2" },
    B3: { value: "=A3&\" report\"" },
  });
  assert.equal(result.A1, "2026-09-29");
  assert.equal(result.B1, "Region");
  assert.equal(result.B2, "TRUE");
  assert.equal(result.B3, "Region report");
});

test("computes aggregate functions over contiguous ranges like the formula contract", () => {
  const result = displays({
    A1: { value: "1" },
    A2: { value: "2" },
    A3: { value: "text" },
    A4: { value: "6" },
    B1: { value: "=SUM(A1:A5)" },
    B2: { value: "=AVERAGE(A1:A4)" },
    B3: { value: "=COUNT(A1:A4)" },
    B4: { value: "=MIN(A1:A4)" },
    B5: { value: "=MAX(A1:A4)" },
    B6: { value: "=sum(a1:a4)" },
  });
  assert.equal(result.B1, "9");
  assert.equal(result.B2, "3");
  assert.equal(result.B3, "3");
  assert.equal(result.B4, "1");
  assert.equal(result.B5, "6");
  assert.equal(result.B6, "9");
});

test("reports the documented formula errors without harming unrelated cells", () => {
  const result = displays({
    A1: { value: "=1/0" },
    A2: { value: "=NOSUCH(1)" },
    A3: { value: "=1+" },
    A4: { value: "=A5+1" },
    A5: { value: "=A4+1" },
    A6: { value: "=ZZZ1" },
    A7: { value: "=#REF!" },
    B1: { value: "=2+2" },
  });
  assert.equal(result.A1, "#DIV/0!");
  assert.equal(result.A2, "#NAME?");
  assert.equal(result.A3, "#ERROR!");
  assert.equal(result.A4, "#REF!");
  assert.equal(result.A5, "#REF!");
  assert.equal(result.A6, "#REF!");
  assert.equal(result.A7, "#REF!");
  assert.equal(result.B1, "4");
});

test("translates the references of a copied formula by the target offset", () => {
  assert.equal(translateFormulaReferences("=B2+$B$2", 0, 2), "=D2+$B$2");
  assert.equal(translateFormulaReferences("=B2+C3", 1, 1), "=C3+D4");
  assert.equal(translateFormulaReferences("=$A1+A$1+$A$1", 2, 3), "=$A3+D$1+$A$1");
  assert.equal(translateFormulaReferences("=SUM(A1:B2)*IF(C1>0,1,2)", 1, 0), "=SUM(A2:B3)*IF(C2>0,1,2)");
  assert.equal(translateFormulaReferences('="A1"&A1', 1, 1), '="A1"&B2');
  assert.equal(translateFormulaReferences("Region", 1, 1), "Region");
});

test("remaps the references of a formula through a structural change", () => {
  // Inserting a row above row 2 moves row 2 and everything after it down by one.
  const shiftRows = ({ row, column }) => ({ row: row >= 2 ? row + 1 : row, column });
  assert.equal(remapFormulaReferences("=B2+$B$3+B1", shiftRows), "=B3+$B$4+B1");
  assert.equal(remapFormulaReferences("=SUM(A2:B4)", shiftRows), "=SUM(A3:B5)");
  assert.equal(remapFormulaReferences('="B2"&B2', shiftRows), '="B2"&B3');
  assert.equal(remapFormulaReferences("Region", shiftRows), "Region");

  // Deleting row 2 moves the rows below it up and leaves a reference to it unresolvable.
  const deleteRow = ({ row, column }) => ({ row: row === 2 ? null : row > 2 ? row - 1 : row, column });
  assert.equal(remapFormulaReferences("=B2*B3", deleteRow), "=#REF!*B2");
  assert.equal(remapFormulaReferences("=$B$2+B1", deleteRow), "=#REF!+B1");
});

test("reports a copy whose offset pushes a relative reference outside the sheet as =#REF!", () => {
  assert.equal(translateFormulaReferences("=A1", 0, -1), "=#REF!");
  assert.equal(translateFormulaReferences("=A1", -1, 0), "=#REF!");
  // The whole copied expression becomes the error value once one relative reference cannot follow.
  assert.equal(translateFormulaReferences("=A1+B1", -1, 0), "=#REF!");
  assert.equal(translateFormulaReferences("=$B$1+A1", 0, -3), "=#REF!");
  assert.equal(translateFormulaReferences("=SUM(A1:A3)", -1, 0), "=#REF!");
  // A reference that already lies outside the sheet keeps its own error inside the expression.
  assert.equal(translateFormulaReferences("=A9999999+B1", 0, 0), "=#REF!+B1");
  // An absolute part never moves, so it is never the reason to fail.
  assert.equal(translateFormulaReferences("=$A$1", -5, -5), "=$A$1");
  // An offset that keeps every reference inside the sheet rewrites them one by one.
  assert.equal(translateFormulaReferences("=A2+B2", -1, 0), "=A1+B1");
  assert.equal(computeWorksheetCells({ A1: { value: "=#REF!" } }).A1.display, "#REF!");
  assert.equal(computeWorksheetCells({ A1: { value: "=B1" }, B1: { value: "=#REF!" } }).A1.display, "#REF!");
});

test("treats blank cells as empty for aggregates, not as zero", () => {
  const result = displays({
    A1: { value: "=SUM(B1:B3)" },
    A2: { value: "=AVERAGE(B1:B3)" },
    A3: { value: "=COUNT(B1:B3)" },
    A4: { value: "=MIN(B1:B3)" },
  });
  assert.equal(result.A1, "0");
  assert.equal(result.A2, "#DIV/0!");
  assert.equal(result.A3, "0");
  assert.equal(result.A4, "0");
});

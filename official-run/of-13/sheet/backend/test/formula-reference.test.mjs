import assert from "node:assert/strict";
import test from "node:test";

import { computeSheetValues } from "../src/domain/formula.mjs";
import {
  adjustFormulaTextForStructure,
  structureShiftMapper,
  translateFormulaText,
} from "../src/domain/reference.mjs";

const SIZE = { rows: 50, columns: 26 };

test("copied formulas shift relative references and keep absolute ones", () => {
  assert.equal(translateFormulaText("=A1+B2", 1, 1, SIZE), "=B2+C3");
  assert.equal(translateFormulaText("=$A1+B$2+$C$3", 1, 1, SIZE), "=$A2+C$2+$C$3");
  assert.equal(translateFormulaText("=SUM(A1:B2)", 2, 0, SIZE), "=SUM(A3:B4)");
  assert.equal(translateFormulaText("=A1", 0, 3, SIZE), "=D1");
  assert.equal(translateFormulaText("=B5", -1, -1, SIZE), "=A4");
});

test("references that would leave the grid become #REF!", () => {
  assert.equal(translateFormulaText("=A1+B1", -1, 0, SIZE), "=#REF!+#REF!");
  assert.equal(translateFormulaText("=$A$1+A1", -2, 0, SIZE), "=$A$1+#REF!");
  assert.equal(translateFormulaText("=A1", 0, 30, SIZE), "=#REF!");
  assert.equal(translateFormulaText("=A1", 0, 25, SIZE), "=Z1");
});

test("text literals and function names are not treated as references", () => {
  assert.equal(translateFormulaText('="A1"&B1', 1, 0, SIZE), '="A1"&B2');
  assert.equal(translateFormulaText("=SUM(A1:A3)", 1, 1, SIZE), "=SUM(B2:B4)");
  assert.equal(translateFormulaText("Region", 1, 1, SIZE), "Region");
  assert.equal(translateFormulaText("=SUM(A1,B1)", 0, 1, SIZE), "=SUM(B1,C1)");
});

test("a formula holding #REF! displays the error and propagates it", () => {
  const values = computeSheetValues({ A1: "=#REF!+1", C1: "=A1+1" });
  assert.equal(values.A1, "#REF!");
  assert.equal(values.C1, "#REF!");
});

test("inserting a row moves every reference at or below the insertion point", () => {
  const above = { axis: "row", action: "insert-above", index: 2 };
  assert.equal(adjustFormulaTextForStructure("=A1+B2", above), "=A1+B3");
  // Absolute references follow the moved data too; only copying keeps `$` parts still.
  assert.equal(adjustFormulaTextForStructure("=$B$2+C$2+$C2", above), "=$B$3+C$3+$C3");
  assert.equal(adjustFormulaTextForStructure("=SUM(A1:A3)", above), "=SUM(A1:A4)");
  assert.equal(adjustFormulaTextForStructure("=Region", above), "=Region");

  const below = { axis: "row", action: "insert-below", index: 1 };
  assert.equal(adjustFormulaTextForStructure("=A1+A2", below), "=A1+A3");
  assert.equal(adjustFormulaTextForStructure("=A2+A3", below), "=A3+A4");
});

test("inserting a column moves the references of that column and the following ones", () => {
  assert.equal(
    adjustFormulaTextForStructure("=A1+B1", { axis: "column", action: "insert-left", index: 2 }),
    "=A1+C1",
  );
  assert.equal(
    adjustFormulaTextForStructure("=A1+B1", { axis: "column", action: "insert-right", index: 1 }),
    "=A1+C1",
  );
  assert.equal(
    adjustFormulaTextForStructure("=SUM(A1:B2)", {
      axis: "column",
      action: "insert-left",
      index: 1,
    }),
    "=SUM(B1:C2)",
  );
});

test("deleting a row or column turns its references into #REF! and pulls the rest back", () => {
  const row = { axis: "row", action: "delete", index: 2 };
  assert.equal(adjustFormulaTextForStructure("=A1+B2", row), "=A1+#REF!");
  assert.equal(adjustFormulaTextForStructure("=A3+A4", row), "=A2+A3");
  assert.equal(adjustFormulaTextForStructure("=SUM(A1:A4)", row), "=SUM(A1:A3)");

  const column = { axis: "column", action: "delete", index: 1 };
  assert.equal(adjustFormulaTextForStructure("=A1+B1", column), "=#REF!+A1");
  assert.equal(adjustFormulaTextForStructure("=C1*2", column), "=B1*2");
});

test("structure changes leave text literals and function names alone", () => {
  const above = { axis: "row", action: "insert-above", index: 1 };
  assert.equal(adjustFormulaTextForStructure('="A1"&SUM(A1:A2)', above), '="A1"&SUM(A2:A3)');
  assert.equal(adjustFormulaTextForStructure("Region", above), "Region");
  assert.equal(adjustFormulaTextForStructure("=A1+1", { axis: "row", action: "nope", index: 1 }), "=A1+1");
  assert.equal(structureShiftMapper({ axis: "row", action: "nope", index: 1 }), null);
  assert.equal(structureShiftMapper({ axis: "row", action: "delete", index: 0 }), null);
});

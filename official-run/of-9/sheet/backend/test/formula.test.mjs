import assert from "node:assert/strict";
import test from "node:test";

import {
  FormulaSyntaxError,
  adjustFormulaForCopy,
  evaluateFormula,
  formulaReferences,
  parseFormula,
} from "../src/lib/formula.mjs";

function context(cells) {
  return {
    hasSheet(name) {
      return name === "" || name === "Sheet1" || name === "Sheet2";
    },
    getCell(sheetName, position) {
      const key = `${String.fromCharCode(64 + position.column)}${position.row}`;
      if (sheetName === "Sheet2") return { value: "99" };
      return cells[key];
    },
  };
}

test("evaluates arithmetic, references and parentheses", () => {
  const ctx = context({ A1: { value: "5" }, B1: { value: "7" }, A2: { value: "Pen" }, B2: { value: "4" } });
  assert.equal(evaluateFormula("=A1+B1*2", ctx), "19");
  assert.equal(evaluateFormula("=(A1+B1)*2", ctx), "24");
  assert.equal(evaluateFormula("=B2+1", ctx), "5");
  assert.equal(evaluateFormula("=-B2", ctx), "-4");
  assert.equal(evaluateFormula("=A1/0", ctx), "#DIV/0!");
  assert.equal(evaluateFormula("=A2+1", ctx), "#VALUE!");
  assert.throws(() => evaluateFormula('="Hello "&"x"', ctx), FormulaSyntaxError);
});

test("resolves references, including empty cells and text passthrough", () => {
  const ctx = context({ A1: { value: "East" }, C3: { value: "1200" } });
  assert.equal(evaluateFormula("=A1", ctx), "East");
  assert.equal(evaluateFormula("=C3", ctx), "1200");
  assert.equal(evaluateFormula("=Z9", ctx), "0");
  assert.equal(evaluateFormula("=A1", context({})), "0");
});

test("evaluates ranges and aggregate functions", () => {
  const ctx = context({
    A1: { value: "10" },
    B1: { value: "20" },
    A2: { value: "East" },
    B2: { value: "30" },
  });
  assert.equal(evaluateFormula("=SUM(A1:B2)", ctx), "60");
  assert.equal(evaluateFormula("=SUM(A1,B1,B2)", ctx), "60");
  assert.equal(evaluateFormula("=AVERAGE(A1,B1)", ctx), "15");
  assert.equal(evaluateFormula("=MIN(A1:B2)", ctx), "10");
  assert.equal(evaluateFormula("=MAX(A1:B2)", ctx), "30");
  assert.equal(evaluateFormula("=COUNT(A1:B2)", ctx), "3");
  assert.equal(evaluateFormula("=COUNTA(A1:B2)", ctx), "4");
  assert.equal(evaluateFormula("=SUM(1,2,3)", ctx), "6");
  assert.equal(evaluateFormula("=AVERAGE(1)", ctx), "1");
});

test("aggregate functions ignore empty cells and count only numeric cells", () => {
  const ctx = context({
    A1: { value: "2" },
    B1: { value: "" },
    A2: { value: "East" },
    B2: { value: "4" },
    C2: { value: "6" },
  });
  assert.equal(evaluateFormula("=SUM(A1:B2)", ctx), "6");
  assert.equal(evaluateFormula("=SUM(A1,B1)", ctx), "2");
  assert.equal(evaluateFormula("=COUNT(A1:B2)", ctx), "2");
  assert.equal(evaluateFormula("=AVERAGE(A1:B2)", ctx), "3");
  assert.equal(evaluateFormula("=MIN(A1:B2)", ctx), "2");
  assert.equal(evaluateFormula("=MAX(A1:B2)", ctx), "4");
  assert.equal(evaluateFormula("=COUNT(A1:B2,C2)", ctx), "3");
});

test("function names are case-insensitive", () => {
  const ctx = context({ A1: { value: "2" }, B1: { value: "3" } });
  assert.equal(evaluateFormula("=sum(a1:b1)", ctx), "5");
  assert.equal(evaluateFormula("=Sum(A1,B1)", ctx), "5");
  assert.equal(evaluateFormula("=aVeRaGe(A1,B1)", ctx), "2.5");
  assert.equal(evaluateFormula("=count(a1:b1)", ctx), "2");
});

test("empty references behave as zero in arithmetic but stay empty for aggregates", () => {
  const ctx = context({ A1: { value: "2" }, B1: { value: "" } });
  assert.equal(evaluateFormula("=A1+B1", ctx), "2");
  assert.equal(evaluateFormula("=B1+1", ctx), "1");
  assert.equal(evaluateFormula("=A1", context({})), "0");
  assert.equal(evaluateFormula("=SUM(A1,B1)", ctx), "2");
});

test("out-of-bounds references and missing sheets display #REF!", () => {
  const ctx = context({});
  assert.equal(evaluateFormula("=A0", ctx), "#REF!");
  assert.equal(evaluateFormula("=NoSheet!A1", ctx), "#REF!");
  assert.equal(evaluateFormula("=SUM(A0:A1)", ctx), "#REF!");
});

test("formats numeric results and propagates errors", () => {
  const ctx = context({});
  assert.equal(evaluateFormula("=2.5*2", ctx), "5");
  assert.equal(evaluateFormula("=1/3*3", ctx), "1");
  assert.equal(evaluateFormula("=SILLY(A1)", ctx), "#NAME?");
  assert.equal(evaluateFormula("=SUM(#REF!)", ctx), "#REF!");
  assert.equal(evaluateFormula("=Sheet2!A1+1", ctx), "100");
});

test("rejects malformed formulas", () => {
  assert.throws(() => parseFormula("=1+"), FormulaSyntaxError);
  assert.throws(() => parseFormula("=SUM(A1:B2"), FormulaSyntaxError);
  assert.throws(() => parseFormula("=(1+2"), FormulaSyntaxError);
  assert.throws(() => parseFormula("=A1:"), FormulaSyntaxError);
  assert.throws(() => parseFormula("="), FormulaSyntaxError);
  assert.throws(() => parseFormula("=1 2"), FormulaSyntaxError);
});

test("adjustFormulaForCopy shifts relative references and ranges", () => {
  assert.equal(adjustFormulaForCopy("=A1+B1", 1, 2), "=C2+D2");
  assert.equal(adjustFormulaForCopy("=SUM(A1:B2)", 1, 1), "=SUM(B2:C3)");
  assert.equal(adjustFormulaForCopy("=$A$1+$B1+C$1", 2, 1), "=$A$1+$B3+D$1");
  assert.equal(adjustFormulaForCopy("=Sheet2!A1+A1", 1, 1), "=Sheet2!A1+B2");
  assert.equal(adjustFormulaForCopy("=A1", 0, -1), "=#REF!");
  assert.equal(adjustFormulaForCopy("=B1", 0, -1), "=A1");
});

test("formulaReferences extracts sheet, absolute flags and positions", () => {
  const refs = formulaReferences("=$A$1+Sheet2!B2+SUM(C1:D3)");
  assert.deepEqual(refs, [
    { sheet: "", absCol: true, absRow: true, row: 1, column: 1 },
    { sheet: "Sheet2", absCol: false, absRow: false, row: 2, column: 2 },
    { sheet: "", absCol: false, absRow: false, row: 1, column: 3 },
    { sheet: "", absCol: false, absRow: false, row: 3, column: 4 },
  ]);
});

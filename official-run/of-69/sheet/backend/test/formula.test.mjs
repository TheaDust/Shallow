import assert from "node:assert/strict";
import test from "node:test";

import {
  DIVIDE_BY_ZERO_ERROR,
  INVALID_REFERENCE_ERROR,
  MALFORMED_EXPRESSION_ERROR,
  UNKNOWN_FUNCTION_ERROR,
  formatNumber,
  isFormulaText,
  numericCellValue,
  recalculateCells,
} from "../src/lib/formula.mjs";

const valueOf = (cells, name) => recalculateCells(cells)[name]?.value;

test("recognises formulas and numeric literals", () => {
  assert.equal(isFormulaText("=A1+1"), true);
  assert.equal(isFormulaText("East"), false);
  assert.equal(numericCellValue("1200"), 1200);
  assert.equal(numericCellValue(" 2.5 "), 2.5);
  assert.equal(numericCellValue("-4"), -4);
  assert.equal(numericCellValue("1e3"), 1000);
  assert.equal(numericCellValue("true"), 1);
  assert.equal(numericCellValue("FALSE"), 0);
  assert.equal(numericCellValue("East"), null);
  assert.equal(numericCellValue(""), null);
  assert.equal(formatNumber(2.00000000001), "2");
  assert.equal(formatNumber(2.5), "2.5");
});

test("evaluates arithmetic, parentheses and references", () => {
  const cells = {
    A1: { value: "2" },
    B1: { value: "3" },
    C1: { formula: "=A1+B1", value: "" },
    C2: { formula: "=C1*2", value: "" },
    C3: { formula: "=(A1+B1)/2", value: "" },
    C4: { formula: "=-A1+10", value: "" },
    C5: { formula: "=A1*2+3", value: "" },
  };
  const result = recalculateCells(cells);
  assert.equal(result.C1.value, "5");
  assert.equal(result.C2.value, "10");
  assert.equal(result.C3.value, "2.5");
  assert.equal(result.C4.value, "8");
  assert.equal(result.C5.value, "7");
  assert.equal(result.C1.formula, "=A1+B1", "the original formula is kept");
  assert.equal(result.A1.value, "2", "ordinary cells keep their submitted text");
});

test("keeps a blank reference at zero in arithmetic", () => {
  assert.equal(valueOf({ A1: { value: "2" }, C1: { formula: "=A1+Z9", value: "" } }, "C1"), "2");
});

test("recalculates directly and indirectly dependent formulas and ignores blank cells", () => {
  const cells = {
    A1: { value: "2" },
    A2: { value: "3" },
    A3: { value: "" },
    B1: { formula: "=SUM(A1:A3)", value: "" },
    B2: { formula: "=AVERAGE(A1:A3)", value: "" },
    B3: { formula: "=COUNT(A1:A3)", value: "" },
    B4: { formula: "=MIN(A1:A3)", value: "" },
    B5: { formula: "=MAX(A1:A3)", value: "" },
    B6: { formula: "=B1*2", value: "" },
  };
  const result = recalculateCells(cells);
  assert.equal(result.B1.value, "5", "SUM ignores the blank cell");
  assert.equal(result.B2.value, "2.5", "AVERAGE divides by numeric cells only");
  assert.equal(result.B3.value, "2", "COUNT counts numeric cells only");
  assert.equal(result.B4.value, "2");
  assert.equal(result.B5.value, "3");
  assert.equal(result.B6.value, "10", "depending on another formula works");

  const updated = recalculateCells({ ...result, A1: { value: "8" } });
  assert.equal(updated.B1.value, "11");
  assert.equal(updated.B6.value, "22");
});

test("uppercases function names and ignores text inside ranges", () => {
  const cells = {
    A1: { value: "East" },
    A2: { value: "4" },
    B1: { formula: "=sum(a2:a2)", value: "" },
    B2: { formula: "=SUM(A1:A2)", value: "" },
  };
  const result = recalculateCells(cells);
  assert.equal(result.B1.value, "4");
  assert.equal(result.B2.value, "4", "text cells inside a range are not numbers");
});

test("reports stable error values", () => {
  const cells = {
    A1: { formula: "=1/0", value: "" },
    A2: { formula: "=FOO(1)", value: "" },
    A3: { formula: "=1+", value: "" },
    A4: { formula: "=#REF!+1", value: "" },
    A5: { formula: "=A5+1", value: "" },
    A6: { formula: "=A7+1", value: "" },
    A7: { formula: "=A6+1", value: "" },
    A8: { formula: "=AVERAGE(B1:B2)", value: "" },
    A9: { formula: "=B1", value: "" },
  };
  const result = recalculateCells(cells);
  assert.equal(result.A1.value, DIVIDE_BY_ZERO_ERROR);
  assert.equal(result.A2.value, UNKNOWN_FUNCTION_ERROR);
  assert.equal(result.A3.value, MALFORMED_EXPRESSION_ERROR);
  assert.equal(result.A4.value, INVALID_REFERENCE_ERROR);
  assert.equal(result.A5.value, INVALID_REFERENCE_ERROR, "self reference is circular");
  assert.equal(result.A6.value, INVALID_REFERENCE_ERROR, "indirect circular reference");
  assert.equal(result.A7.value, INVALID_REFERENCE_ERROR);
  assert.equal(result.A8.value, DIVIDE_BY_ZERO_ERROR, "AVERAGE over no numbers");
  assert.equal(result.A9.value, "0", "blank reference outside arithmetic");
  // One error does not block other cells.
  assert.equal(recalculateCells({ ...result, C1: { formula: "=A1+0", value: "" }, C2: { value: "ok" } }).C2.value, "ok");
});

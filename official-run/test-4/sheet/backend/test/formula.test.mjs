import assert from "node:assert/strict";
import test from "node:test";

import {
  cellName,
  computeSheetResults,
  evaluateFormulaText,
  formatNumber,
  isFormula,
  parseCoord,
} from "../src/lib/formula.mjs";

test("isFormula recognizes equals-prefixed text", () => {
  assert.equal(isFormula("=A1+1"), true);
  assert.equal(isFormula("East"), false);
  assert.equal(isFormula("1200"), false);
  assert.equal(isFormula("=  "), true);
});

test("coordinate helpers", () => {
  assert.deepEqual(parseCoord("A1"), { row: 1, col: 0 });
  assert.deepEqual(parseCoord("B2"), { row: 2, col: 1 });
  assert.deepEqual(parseCoord("AA10"), { row: 10, col: 26 });
  assert.equal(cellName(1, 0), "A1");
  assert.equal(cellName(2, 1), "B2");
  assert.equal(cellName(12, 27), "AB12");
});

test("formatNumber renders integers plainly and cleans floats", () => {
  assert.equal(formatNumber(3), "3");
  assert.equal(formatNumber(1200), "1200");
  assert.equal(formatNumber(3.5), "3.5");
  assert.equal(formatNumber(0.1 + 0.2), "0.3");
  assert.equal(formatNumber(-0), "0");
});

test("evaluates arithmetic with constants, parens and precedence", () => {
  const cells = {};
  const cases = {
    "=1+2": 3,
    "=1+2*3": 7,
    "=(1+2)*3": 9,
    "=10-4/2": 8,
    "=7-5": 2,
    "=2*3+4*5": 26,
    "=-5+1": -4,
    "=2.5*4": 10,
  };
  for (const [formula, expected] of Object.entries(cases)) {
    assert.equal(evaluateFormulaText(formula, cells, "A1"), expected, formula);
  }
});

test("evaluates A1-style references and chains dependent formulas", () => {
  const cells = {
    A1: "2",
    B1: "3",
    C1: "=A1+B1",
    D1: "=C1*2",
    E1: "=D1+1",
  };
  const results = computeSheetResults(cells);
  assert.equal(results.C1, "5");
  assert.equal(results.D1, "10");
  assert.equal(results.E1, "11");
});

test("references keep working after a source value changes", () => {
  let cells = { A1: "2", B1: "3", C1: "=A1+B1", D1: "=C1*2" };
  assert.equal(computeSheetResults(cells).D1, "10");
  cells = { A1: "4", B1: "3", C1: "=A1+B1", D1: "=C1*2" };
  assert.equal(computeSheetResults(cells).D1, "14");
  cells = { A1: "4", B1: "3", C1: "=A1+B1", D1: "=C1*2", E1: "=D1*3" };
  assert.equal(computeSheetResults(cells).E1, "42");
});

test("aggregate functions over ranges and single cells", () => {
  const cells = {
    A1: "10",
    B1: "20",
    A2: "30",
    B2: "40",
    C1: "=SUM(A1:B2)",
    C2: "=AVERAGE(A1:B2)",
    C3: "=COUNT(A1:B2)",
    C4: "=MIN(A1:B2)",
    C5: "=MAX(A1:B2)",
    C6: "=SUM(A1)",
  };
  const results = computeSheetResults(cells);
  assert.equal(results.C1, "100");
  assert.equal(results.C2, "25");
  assert.equal(results.C3, "4");
  assert.equal(results.C4, "10");
  assert.equal(results.C5, "40");
  assert.equal(results.C6, "10");
});

test("aggregates ignore empty and non-numeric cells; COUNT counts only numbers", () => {
  const cells = {
    A1: "10",
    B1: "",
    A2: "East",
    B2: "30",
    C1: "=SUM(A1:B2)",
    C2: "=AVERAGE(A1:B2)",
    C3: "=COUNT(A1:B2)",
    C4: "=MIN(A1:B2)",
    C5: "=MAX(A1:B2)",
  };
  const results = computeSheetResults(cells);
  assert.equal(results.C1, "40");
  assert.equal(results.C2, "20");
  assert.equal(results.C3, "2");
  assert.equal(results.C4, "10");
  assert.equal(results.C5, "30");
});

test("function names are case-insensitive", () => {
  const cells = { A1: "2", B1: "3", C1: "=sum(A1:B1)", D1: "=Sum(A1:B1)", E1: "=SUM(a1:b1)" };
  const results = computeSheetResults(cells);
  assert.equal(results.C1, "5");
  assert.equal(results.D1, "5");
  assert.equal(results.E1, "5");
});

test("aggregates accept multiple arguments including constants", () => {
  const cells = { A1: "2", B1: "3", C1: "=SUM(A1:B1, 10)", D1: "=SUM(A1, B1)" };
  const results = computeSheetResults(cells);
  assert.equal(results.C1, "15");
  assert.equal(results.D1, "5");
});

test("aggregates over a range that contains a formula cell use its result", () => {
  const cells = { A1: "2", B1: "3", C1: "=A1+B1", D1: "=SUM(A1:C1)" };
  const results = computeSheetResults(cells);
  assert.equal(results.D1, "10");
});

test("division by zero displays #DIV/0!", () => {
  const cells = { A1: "1", B1: "0", C1: "=A1/B1", D1: "=1/0" };
  const results = computeSheetResults(cells);
  assert.equal(results.C1, "#DIV/0!");
  assert.equal(results.D1, "#DIV/0!");
});

test("malformed expressions display #ERROR!", () => {
  const cells = {
    A1: "=1+",
    B1: "=(1+2",
    C1: "=1 2",
    D1: "=",
    E1: "=*3",
  };
  const results = computeSheetResults(cells);
  assert.equal(results.A1, "#ERROR!");
  assert.equal(results.B1, "#ERROR!");
  assert.equal(results.C1, "#ERROR!");
  assert.equal(results.D1, "#ERROR!");
  assert.equal(results.E1, "#ERROR!");
});

test("unsupported functions display #NAME?", () => {
  const cells = { A1: "=FOO(1)", B1: "=SUMX(A1:B2)" };
  const results = computeSheetResults(cells);
  assert.equal(results.A1, "#NAME?");
  assert.equal(results.B1, "#NAME?");
});

test("direct and indirect circular references display #REF!", () => {
  const cells = {
    A1: "=B1",
    B1: "=A1",
    C1: "=D1+1",
    D1: "=C1*2",
  };
  const results = computeSheetResults(cells);
  assert.equal(results.A1, "#REF!");
  assert.equal(results.B1, "#REF!");
  assert.equal(results.C1, "#REF!");
  assert.equal(results.D1, "#REF!");
});

test("literal #REF! tokens from structure ops propagate", () => {
  const cells = { A1: "=#REF!+C1", B1: "=#REF!" };
  const results = computeSheetResults(cells);
  assert.equal(results.A1, "#REF!");
  assert.equal(results.B1, "#REF!");
});

test("aggregate arguments that are literal error tokens propagate the error", () => {
  // Copying =SUM(A1:B2) so a relative reference moves outside the worksheet
  // bounds rewrites the range to #REF! (REQ-4-1-2); the aggregate must show
  // #REF! instead of treating the rewritten argument as empty.
  const cells = {
    A1: "=SUM(#REF!)",
    B1: "=SUM(#REF!, 5)",
    C1: "=SUM(#REF!, 1)",
    D1: "=AVERAGE(#REF!)",
    E1: "=COUNT(#REF!)",
    F1: "=MIN(#REF!)",
    G1: "=MAX(#REF!)",
  };
  const results = computeSheetResults(cells);
  assert.equal(results.A1, "#REF!");
  assert.equal(results.B1, "#REF!");
  assert.equal(results.C1, "#REF!");
  assert.equal(results.D1, "#REF!");
  assert.equal(results.E1, "#REF!");
  assert.equal(results.F1, "#REF!");
  assert.equal(results.G1, "#REF!");
});

test("aggregate arguments propagate division-by-zero errors from subexpressions", () => {
  const cells = { A1: "=SUM(1/0)", B1: "=SUM(A1, 2)" };
  const results = computeSheetResults(cells);
  assert.equal(results.A1, "#DIV/0!");
  assert.equal(results.B1, "#DIV/0!");
});

test("only formula cells appear in the results map", () => {
  const cells = { A1: "Region", B1: "=1+1", C1: "1200" };
  const results = computeSheetResults(cells);
  assert.deepEqual(Object.keys(results), ["B1"]);
  assert.equal(results.B1, "2");
});

test("non-numeric text in arithmetic displays #ERROR!", () => {
  const cells = { A1: "East", B1: "=A1+1" };
  const results = computeSheetResults(cells);
  assert.equal(results.B1, "#ERROR!");
});

test("a formula referencing an empty cell treats it as zero in arithmetic", () => {
  const cells = { A1: "=B1+1" };
  const results = computeSheetResults(cells);
  assert.equal(results.A1, "1");
});

test("absolute $A$1-style references evaluate and lock during copy (REQ-4-1-2)", () => {
  const cells = {
    A1: "2",
    B1: "3",
    C1: "=$A$1*2",
    D1: "=$A1+B1",
    E1: "=A$1+B1",
    F1: "=SUM($A$1:B1)",
    G1: "=SUM($A$1, B1)",
  };
  const results = computeSheetResults(cells);
  assert.equal(results.C1, "4");
  assert.equal(results.D1, "5");
  assert.equal(results.E1, "5");
  assert.equal(results.F1, "5");
  assert.equal(results.G1, "5");
});

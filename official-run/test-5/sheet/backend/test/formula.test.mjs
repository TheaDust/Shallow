import test from "node:test";
import assert from "node:assert/strict";

import { worksheetValues } from "../src/domain/formula.mjs";

function values(cells) {
  return worksheetValues({ cells });
}

test("ordinary cells keep the text the user typed", () => {
  const result = values({
    A1: "Region",
    B1: "1200",
    C1: "TRUE",
    D1: "2026-01-15",
    E1: "-12.5",
    F1: "Pen",
  });
  assert.deepEqual(result, {
    A1: "Region",
    B1: "1200",
    C1: "TRUE",
    D1: "2026-01-15",
    E1: "-12.5",
    F1: "Pen",
  });
});

test("formulas calculate arithmetic with the usual precedence", () => {
  const result = values({
    A1: "10",
    A2: "20",
    B1: "=A1+A2",
    B2: "=A2-A1",
    B3: "=A1*A2",
    B4: "=A2/A1",
    B5: "=1+2*3",
    B6: "=(1+2)*3",
    B7: "=-A1+2",
    B8: "=2^3",
    B9: "=0.1+0.2",
  });
  assert.equal(result.B1, "30");
  assert.equal(result.B2, "10");
  assert.equal(result.B3, "200");
  assert.equal(result.B4, "2");
  assert.equal(result.B5, "7");
  assert.equal(result.B6, "9");
  assert.equal(result.B7, "-8");
  assert.equal(result.B8, "8");
  assert.equal(result.B9, "0.3");
});

test("dependent formulas recalculate directly and indirectly", () => {
  const result = values({ A1: "2", B1: "=A1*3", C1: "=B1+A1", D1: "=C1*2" });
  assert.equal(result.B1, "6");
  assert.equal(result.C1, "8");
  assert.equal(result.D1, "16");

  const changed = values({ A1: "5", B1: "=A1*3", C1: "=B1+A1", D1: "=C1*2" });
  assert.equal(changed.B1, "15");
  assert.equal(changed.C1, "20");
  assert.equal(changed.D1, "40");
});

test("aggregate functions ignore blanks and text, COUNT counts numeric cells only", () => {
  const cells = { A1: "10", A2: "text", A3: "20", B1: "=SUM(A1:A3)", B2: "=COUNT(A1:A4)", B3: "=AVERAGE(A1:A3)", B4: "=MIN(A1:A3)", B5: "=MAX(A1:A3)", B6: "=SUM(A1:A4)" };
  const result = values(cells);
  assert.equal(result.B1, "30");
  assert.equal(result.B2, "2");
  assert.equal(result.B3, "15");
  assert.equal(result.B4, "10");
  assert.equal(result.B5, "20");
  assert.equal(result.B6, "30");
});

test("function names are case-insensitive and take several arguments", () => {
  const result = values({ A1: "1", A2: "2", A3: "3", B1: "=sum(a1:a2,a3)", B2: "=Max(A1,A3)" });
  assert.equal(result.B1, "6");
  assert.equal(result.B2, "3");
});

test("text operands and unsupported syntax report explicit errors", () => {
  const result = values({
    A1: "East",
    B1: "=A1+1",
    B2: "=NOPE(1)",
    B3: "=1+",
    B4: "=A1&\"x\"",
    B5: '="ab"',
  });
  assert.equal(result.B1, "#VALUE!");
  assert.equal(result.B2, "#NAME?");
  assert.equal(result.B3, "#ERROR!");
  assert.equal(result.B4, "#ERROR!");
  assert.equal(result.B5, "ab");
});

test("division by zero and circular references report errors", () => {
  const result = values({
    A1: "0",
    B1: "=10/A1",
    B2: "=C2",
    C2: "=B2",
    B3: "=A41",
  });
  assert.equal(result.B1, "#DIV/0!");
  assert.equal(result.B2, "#REF!");
  assert.equal(result.C2, "#REF!");
  assert.equal(result.B3, "#REF!");
});

test("a reference to an empty cell and out-of-grid references", () => {
  const result = values({ A1: "=B1", A2: "=AA1", A3: "=SUM(B1:B3)" });
  assert.equal(result.A1, "0");
  assert.equal(result.A2, "#REF!");
  assert.equal(result.A3, "0");
});

test("an error value stored in the formula text keeps its own code", () => {
  // A reference a copy or a structure change could not preserve is stored as
  // `#REF!` inside the formula (REQ-4-1-2), so the engine reads it back.
  const result = values({
    A1: "5",
    B1: "=#REF!",
    B2: "=#REF!+1",
    B3: "=SUM(#REF!,A1)",
    B4: "=#div/0!",
    B5: "=A1#",
  });
  assert.equal(result.B1, "#REF!");
  assert.equal(result.B2, "#REF!");
  assert.equal(result.B3, "#REF!");
  assert.equal(result.B4, "#DIV/0!");
  // A lone `#` is still a malformed expression, and it must not reach others.
  assert.equal(result.B5, "#ERROR!");
  assert.equal(result.A1, "5");
});

test("error values propagate into dependent formulas", () => {
  const result = values({ A1: "0", B1: "=1/A1", C1: "=B1+1", D1: "=SUM(B1:C1)" });
  assert.equal(result.C1, "#DIV/0!");
  assert.equal(result.D1, "#DIV/0!");
});

import assert from "node:assert/strict";
import test from "node:test";

import { computeSheetValues } from "../src/domain/formula.mjs";

function values(cells) {
  return computeSheetValues(cells);
}

test("evaluates numeric constants, parentheses and operator precedence", () => {
  assert.deepEqual(values({ A1: "=1+2*3" }), { A1: "7" });
  assert.deepEqual(values({ A1: "=(1+2)*3" }), { A1: "9" });
  assert.deepEqual(values({ A1: "=10-2-3" }), { A1: "5" });
  assert.deepEqual(values({ A1: "=12/4/3" }), { A1: "1" });
  assert.deepEqual(values({ A1: "=-3+1" }), { A1: "-2" });
  assert.deepEqual(values({ A1: "=2.5*4" }), { A1: "10" });
  assert.deepEqual(values({ A1: "=0.1+0.2" }), { A1: "0.3" });
});

test("resolves references and recalculates dependent formulas in order", () => {
  assert.deepEqual(
    values({ A1: "2", B1: "3", C1: "=A1+B1", D1: "=C1*2", E1: "=D1-C1+A1" }),
    { A1: "2", B1: "3", C1: "5", D1: "10", E1: "7" },
  );
});

test("treats empty cells as zero in arithmetic and ignores them in aggregates", () => {
  assert.deepEqual(values({ A1: "=B1+1" }), { A1: "1" });
  assert.deepEqual(values({ A1: "=SUM(B1:B3)" }), { A1: "0" });
  assert.deepEqual(
    values({ A1: "2", A2: "", A3: "4", B1: "=AVERAGE(A1:A3)", B2: "=COUNT(A1:A3)" }),
    { A1: "2", A3: "4", B1: "3", B2: "2" },
  );
  // Text cells are ignored by the aggregates, they are not treated as zero.
  assert.deepEqual(
    values({ A1: "2", A2: "east", A3: "4", B1: "=SUM(A1:A3)", B2: "=COUNT(A1:A3)" }),
    { A1: "2", A2: "east", A3: "4", B1: "6", B2: "2" },
  );
});

test("supports SUM, AVERAGE, COUNT, MIN and MAX with case-insensitive names", () => {
  const cells = { A1: "1", A2: "2", A3: "3" };
  assert.deepEqual(
    values({
      ...cells,
      A4: "=sum(A1:A3)",
      A5: "=Average(A1:A3)",
      A6: "=COUNT(A1:A3)",
      A7: "=min(A1:A3)",
      A8: "=MAX(A1:A3)",
    }),
    { A1: "1", A2: "2", A3: "3", A4: "6", A5: "2", A6: "3", A7: "1", A8: "3" },
  );
});

test("uses the stable error values for failing formulas", () => {
  assert.deepEqual(values({ A1: "=1/0" }), { A1: "#DIV/0!" });
  assert.deepEqual(values({ A1: "=ZZ1" }), { A1: "#REF!" });
  assert.deepEqual(values({ A1: "=A1+1" }), { A1: "#REF!" });
  assert.deepEqual(values({ A1: "=B1", B1: "=A1" }), { A1: "#REF!", B1: "#REF!" });
  assert.deepEqual(values({ A1: "=TOTALLY(1)" }), { A1: "#NAME?" });
  assert.deepEqual(values({ A1: "=1+" }), { A1: "#ERROR!" });
  assert.deepEqual(values({ A1: "=" }), { A1: "#ERROR!" });
  assert.deepEqual(values({ A1: "=(1+2" }), { A1: "#ERROR!" });
  assert.deepEqual(values({ A1: '="east"+1' }), { A1: "#ERROR!" });
  assert.deepEqual(values({ A1: "=east+1" }), { A1: "#NAME?" });
  assert.deepEqual(values({ A1: "=234" }), { A1: "234" });
});

test("an A1-shaped address with an impossible row is an invalid reference", () => {
  // Row 0 does not exist in A1 notation; the reference is invalid, not a malformed expression.
  assert.deepEqual(values({ A1: "=A0" }), { A1: "#REF!" });
  assert.deepEqual(values({ D11: "=$A$0" }), { D11: "#REF!" });
  assert.deepEqual(values({ D11: "=A0+B1", B1: "3" }), { B1: "3", D11: "#REF!" });
  // A reference beyond the sheet is invalid in the same way.
  assert.deepEqual(values({ D11: "=A100" }), { D11: "#REF!" });
  assert.deepEqual(values({ D11: "=SUM(A0:A2)" }), { D11: "#REF!" });
  // The invalid reference stays isolated: other cells keep their own results.
  assert.deepEqual(
    values({ A1: "2", B1: "=A1+1", D11: "=A0", E11: "=1/0" }),
    { A1: "2", B1: "3", D11: "#REF!", E11: "#DIV/0!" },
  );
});

test("accepts several arguments and nested calls, and keeps aggregate blanks out of the count", () => {
  assert.deepEqual(
    values({
      A1: "2",
      A2: "text",
      B1: "4",
      B2: "",
      C1: "=SUM(A1:A2,B1:B2)",
      C2: "=COUNT(A1:B2)",
      C3: "=MAX(MIN(A1:B1),1)",
      C4: "=SUM(A1:B2)/COUNT(A1:B2)",
    }),
    { A1: "2", A2: "text", B1: "4", C1: "6", C2: "2", C3: "2", C4: "3" },
  );
  // A range without numeric cells has no average; text and blanks are not zeroes.
  assert.deepEqual(values({ A1: "", A2: "east", B1: "=AVERAGE(A1:A2)", B2: "=COUNT(A1:A2)" }), {
    A2: "east",
    B1: "#DIV/0!",
    B2: "0",
  });
});

test("propagates an error through the formulas that depend on it, leaving others alone", () => {
  assert.deepEqual(
    values({ A1: "=1/0", B1: "=A1+1", C1: "=5+5", D1: "=SUM(A1:A1)" }),
    { A1: "#DIV/0!", B1: "#DIV/0!", C1: "10", D1: "#DIV/0!" },
  );
});

test("keeps ordinary text untouched and only computes formulas", () => {
  assert.deepEqual(
    values({ A1: "Item/Qty", B1: "Pen/4", C1: "true", D1: "2026-03-14", E1: "0012" }),
    { A1: "Item/Qty", B1: "Pen/4", C1: "true", D1: "2026-03-14", E1: "0012" },
  );
  assert.deepEqual(values({}), {});
});

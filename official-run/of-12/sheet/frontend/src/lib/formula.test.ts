import { describe, expect, it } from "vitest";

import {
  cellDisplayText,
  DIVISION_BY_ZERO,
  evaluateFormula,
  INVALID_REFERENCE,
  MALFORMED_FORMULA,
  UNKNOWN_FUNCTION,
  INVALID_VALUE,
  worksheetResults,
} from "./formula";

describe("arithmetic expressions", () => {
  it("honours operator precedence, parentheses and unary signs", () => {
    expect(evaluateFormula("=1+2*3")).toBe("7");
    expect(evaluateFormula("=(1+2)*3")).toBe("9");
    expect(evaluateFormula("=2-3-4")).toBe("-5");
    expect(evaluateFormula("=10/4")).toBe("2.5");
    expect(evaluateFormula("=-2+5")).toBe("3");
    expect(evaluateFormula("=0.1+0.2")).toBe("0.3");
  });

  it("keeps the raw text of an ordinary cell while a formula shows its result", () => {
    expect(cellDisplayText("1200", undefined)).toBe("1200");
    expect(cellDisplayText("East", undefined)).toBe("East");
    expect(cellDisplayText("=B2*2", "2400")).toBe("2400");
    expect(cellDisplayText(undefined, undefined)).toBe("");
  });
});

describe("references and dependencies", () => {
  const cells = { A1: "2", B1: "3", C1: "=A1+B1", D1: "=C1*2", E1: "=10/D1" };

  it("resolves same-worksheet references and follows direct and indirect dependents", () => {
    expect(worksheetResults(cells)).toEqual({ C1: "5", D1: "10", E1: "1" });
  });

  it("recalculates when a source value changes", () => {
    expect(worksheetResults({ ...cells, A1: "4" })).toMatchObject({ C1: "7", D1: "14", E1: "0.714285714286" });
  });

  it("treats a reference to a blank cell as zero and keeps `$` markers out of the way", () => {
    expect(evaluateFormula("=Z9", {})).toBe("0");
    expect(evaluateFormula("=$A$1+B1", { A1: "2", B1: "3" })).toBe("5");
  });

  it("reads numeric text and boolean-like cells as numbers in arithmetic", () => {
    expect(evaluateFormula("=A1+1", { A1: " 4 " })).toBe("5");
    expect(evaluateFormula("=A1+1", { A1: "TRUE" })).toBe("2");
    expect(evaluateFormula('=A1+1', { A1: "2024-01-15" })).toBe(INVALID_VALUE);
  });
});

describe("aggregate functions", () => {
  const cells = {
    A1: "2", A2: "3", A3: "text", A4: "", A5: "=A1+A2",
    B1: "10", B2: "-4", B3: "TRUE",
  };

  it("supports SUM, AVERAGE, COUNT, MIN and MAX over contiguous ranges", () => {
    expect(evaluateFormula("=SUM(A1:A5)", cells)).toBe("10");
    expect(evaluateFormula("=AVERAGE(A1:A4)", cells)).toBe("2.5");
    expect(evaluateFormula("=COUNT(A1:B3)", cells)).toBe("4");
    expect(evaluateFormula("=MIN(B1:B2)", cells)).toBe("-4");
    expect(evaluateFormula("=MAX(B1:B2)", cells)).toBe("10");
  });

  it("accepts letters in either case and several arguments", () => {
    expect(evaluateFormula("=sum(a1:a2, 5)", cells)).toBe("10");
    expect(evaluateFormula("=Sum(A1:A2)+MAX(A1:A2)", cells)).toBe("8");
  });

  it("ignores blanks and text instead of treating them as zero", () => {
    expect(evaluateFormula("=SUM(A3:A4)", cells)).toBe("0");
    expect(evaluateFormula("=COUNT(A3:A4)", cells)).toBe("0");
    expect(evaluateFormula("=AVERAGE(A3:A4)", cells)).toBe(DIVISION_BY_ZERO);
    expect(evaluateFormula("=MIN(A1:A2)", cells)).toBe("2");
  });
});

describe("errors", () => {
  it("reports the stable error values", () => {
    expect(evaluateFormula("=1/0")).toBe(DIVISION_BY_ZERO);
    expect(evaluateFormula("=NOPE(1)")).toBe(UNKNOWN_FUNCTION);
    expect(evaluateFormula("=1+")).toBe(MALFORMED_FORMULA);
    expect(evaluateFormula("=A1+A2", { A1: "text" })).toBe(INVALID_VALUE);
    expect(evaluateFormula("=Other!A1")).toBe(INVALID_REFERENCE);
    expect(evaluateFormula("=A1")).toBe("0");
  });

  it("reads a reference shaped word that names no cell as #REF! and a bare name as #NAME?", () => {
    expect(evaluateFormula("=A0")).toBe(INVALID_REFERENCE);
    expect(evaluateFormula("=A0+1")).toBe(INVALID_REFERENCE);
    expect(evaluateFormula("=$A$0")).toBe(INVALID_REFERENCE);
    expect(evaluateFormula("=AAAA1*2")).toBe(INVALID_REFERENCE);
    expect(evaluateFormula("=TOTAL")).toBe(UNKNOWN_FUNCTION);
    expect(evaluateFormula("=SUM")).toBe(UNKNOWN_FUNCTION);
    // A range written through a valid endpoint keeps the reference of that endpoint.
    expect(evaluateFormula("=A1", { A1: "7" })).toBe("7");
  });

  it("propagates the error of a referenced cell into the dependents only", () => {
    const cells = { A1: "=1/0", B1: "=A1+1", C1: "=2+2", D1: "=SUM(A1:C1)" };
    expect(worksheetResults(cells)).toEqual({
      A1: DIVISION_BY_ZERO,
      B1: DIVISION_BY_ZERO,
      C1: "4",
      D1: DIVISION_BY_ZERO,
    });
  });

  it("keeps the error text produced by a row/column shift visible in the grid", () => {
    expect(worksheetResults({ A1: "=#REF!" })).toEqual({ A1: INVALID_REFERENCE });
  });

  it("resolves a direct or indirect circular reference to #REF! instead of recursing", () => {
    expect(worksheetResults({ A1: "=A1" })).toEqual({ A1: INVALID_REFERENCE });
    expect(worksheetResults({ A1: "=B1", B1: "=A1" })).toEqual({ A1: INVALID_REFERENCE, B1: INVALID_REFERENCE });
  });

  it("isolates one broken formula from unrelated cells", () => {
    expect(worksheetResults({ A1: "=1/0", B1: "=2+2" })).toEqual({ A1: DIVISION_BY_ZERO, B1: "4" });
  });
});

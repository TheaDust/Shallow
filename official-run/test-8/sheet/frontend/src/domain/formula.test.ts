import { describe, expect, it } from "vitest";

import {
  DIVIDE_BY_ZERO_ERROR,
  INVALID_REFERENCE_ERROR,
  MALFORMED_EXPRESSION_ERROR,
  UNKNOWN_FUNCTION_ERROR,
  evaluateCells,
  isFormula,
  numericTextValue,
} from "./formula";

describe("isFormula", () => {
  it("marks only text that starts with an equals sign", () => {
    expect(isFormula("=A1+B1")).toBe(true);
    expect(isFormula("1200")).toBe(false);
    expect(isFormula("East = North")).toBe(false);
    expect(isFormula(undefined)).toBe(false);
  });
});

describe("numericTextValue", () => {
  it("parses plain numbers and rejects dates and text", () => {
    expect(numericTextValue("1200")).toBe(1200);
    expect(numericTextValue(" 2.5 ")).toBe(2.5);
    expect(numericTextValue("-3")).toBe(-3);
    expect(numericTextValue("2024-07-01")).toBeNull();
    expect(numericTextValue("East")).toBeNull();
    expect(numericTextValue("")).toBeNull();
  });
});

describe("evaluateCells", () => {
  it("keeps ordinary text and numbers exactly as entered", () => {
    const display = evaluateCells({ A1: "East", B1: "1200", C1: "2024-07-01", D1: "true" });
    expect(display).toEqual({ A1: "East", B1: "1200", C1: "2024-07-01", D1: "true" });
  });

  it("calculates expressions with constants, parentheses and references", () => {
    const display = evaluateCells({ A1: "2", B1: "3", C1: "=A1+B1", D1: "=C1*2", E1: "=(A1+B1)*3" });
    expect(display.C1).toBe("5");
    expect(display.D1).toBe("10");
    expect(display.E1).toBe("15");
    expect(display.A1).toBe("2");
  });

  it("supports the aggregate functions over contiguous ranges", () => {
    const cells = {
      A1: "10",
      A2: "20",
      A3: "note",
      A4: "",
      B1: "=SUM(A1:A4)",
      B2: "=AVERAGE(A1:A4)",
      B3: "=COUNT(A1:A4)",
      B4: "=MIN(A1:A4)",
      B5: "=MAX(A1:A4)",
      B6: "=sum(a1:a4)",
    };
    const display = evaluateCells(cells);
    expect(display.B1).toBe("30");
    expect(display.B2).toBe("15");
    expect(display.B3).toBe("2");
    expect(display.B4).toBe("10");
    expect(display.B5).toBe("20");
    expect(display.B6).toBe("30");
  });

  it("recalculates directly and indirectly dependent formulas from the same source map", () => {
    const display = evaluateCells({ A1: "1200", B1: "800", C1: "=A1+B1", D1: "=C1*2" });
    expect(display.C1).toBe("2000");
    expect(display.D1).toBe("4000");

    const updated = evaluateCells({ A1: "100", B1: "800", C1: "=A1+B1", D1: "=C1*2" });
    expect(updated.C1).toBe("900");
    expect(updated.D1).toBe("1800");
  });

  it("shows stable error values", () => {
    const display = evaluateCells({
      A1: "=1/0",
      A2: "=NOSUCH(1)",
      A3: "=1+",
      A4: "=A4+1",
      A5: "=A6+1",
      A6: "=A5+1",
    });
    expect(display.A1).toBe(DIVIDE_BY_ZERO_ERROR);
    expect(display.A2).toBe(UNKNOWN_FUNCTION_ERROR);
    expect(display.A3).toBe(MALFORMED_EXPRESSION_ERROR);
    expect(display.A4).toBe(INVALID_REFERENCE_ERROR);
    expect(display.A5).toBe(INVALID_REFERENCE_ERROR);
    expect(display.A6).toBe(INVALID_REFERENCE_ERROR);
  });

  it("shows the referenced cell's own text for a plain reference", () => {
    const display = evaluateCells({
      A1: "Item",
      B1: "Qty",
      C1: "=A1",
      D1: "=B1",
      E1: "=C1",
      F1: "=SUM(A1:B1)",
    });
    expect(display.C1).toBe("Item");
    expect(display.D1).toBe("Qty");
    // An indirect dependent keeps following the referenced text.
    expect(display.E1).toBe("Item");
    // Aggregates still use only numeric cells.
    expect(display.F1).toBe("0");
  });

  it("keeps arithmetic on text an error and lets a referenced error through", () => {
    const display = evaluateCells({
      A1: "Item",
      B1: "=A1+1",
      C1: "=A1&\" sold\"",
      D1: "=1/0",
      E1: "=D1",
      F1: "=D1+1",
    });
    expect(display.B1).toBe(MALFORMED_EXPRESSION_ERROR);
    expect(display.C1).toBe(MALFORMED_EXPRESSION_ERROR);
    expect(display.E1).toBe(DIVIDE_BY_ZERO_ERROR);
    expect(display.F1).toBe(DIVIDE_BY_ZERO_ERROR);
    expect(display.A1).toBe("Item");
  });

  it("isolates one error cell from unrelated formulas", () => {
    const display = evaluateCells({ A1: "=1/0", B1: "2", C1: "=B1*4" });
    expect(display.A1).toBe(DIVIDE_BY_ZERO_ERROR);
    expect(display.C1).toBe("8");
  });

  it("recalculates a dependent once its error source becomes a valid formula", () => {
    const before = evaluateCells({ A1: "=1/0", B1: "=A1+1", C1: "=B1*2" });
    expect(before.A1).toBe(DIVIDE_BY_ZERO_ERROR);
    expect(before.B1).toBe(DIVIDE_BY_ZERO_ERROR);
    expect(before.C1).toBe(DIVIDE_BY_ZERO_ERROR);

    const after = evaluateCells({ A1: "=5", B1: "=A1+1", C1: "=B1*2" });
    expect(after.A1).toBe("5");
    expect(after.B1).toBe("6");
    expect(after.C1).toBe("12");
  });

  it("keeps a literal =#REF! formula as an error without blocking unrelated cells", () => {
    const display = evaluateCells({ A1: "=#REF!", B1: "=A1", C1: "=2*3" });
    expect(display.A1).toBe(INVALID_REFERENCE_ERROR);
    expect(display.B1).toBe(INVALID_REFERENCE_ERROR);
    expect(display.C1).toBe("6");
  });

  it("reports a reference outside the sheet as #REF!", () => {
    expect(evaluateCells({ A1: "=A0" }).A1).toBe(INVALID_REFERENCE_ERROR);
    expect(evaluateCells({ A1: "=A0+1" }).A1).toBe(INVALID_REFERENCE_ERROR);
  });

  it("reports an unsupported function as #NAME? whatever its case", () => {
    expect(evaluateCells({ A1: "=BOGUS()" }).A1).toBe(UNKNOWN_FUNCTION_ERROR);
    expect(evaluateCells({ A1: "=nosuch(1,2)" }).A1).toBe(UNKNOWN_FUNCTION_ERROR);
  });

  it("calculates the shifted formulas of a row insertion from their new coordinates", () => {
    const display = evaluateCells({ A2: "2", B2: "3", C2: "=A2+B2", D2: "=C2*2" });
    expect(display.C2).toBe("5");
    expect(display.D2).toBe("10");
  });

  it("accepts absolute and mixed A1 references", () => {
    const display = evaluateCells({
      A1: "2",
      B1: "3",
      C1: "=$A$1+$B$1",
      D1: "=$A1+B$1",
      E1: "=$A$1*2",
    });
    expect(display.C1).toBe("5");
    expect(display.D1).toBe("5");
    expect(display.E1).toBe("4");
  });

  it("follows operator precedence and left associativity", () => {
    const display = evaluateCells({
      A1: "=(2+3)*4",
      B1: "=10-2-3",
      C1: "=20/2/5",
      D1: "=-2*3",
      E1: "=2+3*4",
    });
    expect(display.A1).toBe("20");
    expect(display.B1).toBe("5");
    expect(display.C1).toBe("2");
    expect(display.D1).toBe("-6");
    expect(display.E1).toBe("14");
  });

  it("treats blank references as zero and ignores blanks in aggregates", () => {
    const display = evaluateCells({ A1: "", B1: "=A1+5", C1: "=SUM(A1:A1)" });
    expect(display.B1).toBe("5");
    expect(display.C1).toBe("0");
  });
});

import { describe, expect, it } from "vitest";
import { computeDisplayCells, displayValue, evaluateFormula } from "./formula";

describe("formula evaluation (REQ-3-1-1 formula cells / REQ-4-1-1 language)", () => {
  it("evaluates numeric constants with precedence and parentheses", () => {
    expect(evaluateFormula("=1+2*3", {})).toBe("7");
    expect(evaluateFormula("=(1+2)*3", {})).toBe("9");
    expect(evaluateFormula("=10-4/2", {})).toBe("8");
    expect(evaluateFormula("=-5+10", {})).toBe("5");
    expect(evaluateFormula("=2.5*4", {})).toBe("10");
  });

  it("resolves A1-style references from the current cells", () => {
    const cells = { A1: "2", B1: "3", C1: "=A1+B1" };
    expect(evaluateFormula("=A1+B1", cells)).toBe("5");
    expect(displayValue("=C1*2", cells)).toBe("10");
  });

  it("direct references pass through text values and empty cells behave as zero", () => {
    expect(evaluateFormula("=A1", { A1: "Pen" })).toBe("Pen");
    expect(evaluateFormula("=A1+1", {})).toBe("1");
  });

  it("aggregate functions are case-insensitive and accept contiguous ranges", () => {
    const cells = { A1: "2", B1: "3", A2: "4", B2: "5" };
    expect(evaluateFormula("=SUM(A1:B2)", cells)).toBe("14");
    expect(evaluateFormula("=sum(A1:B2)", cells)).toBe("14");
    expect(evaluateFormula("=AVERAGE(A1:B2)", cells)).toBe("3.5");
    expect(evaluateFormula("=COUNT(A1:B2)", cells)).toBe("4");
    expect(evaluateFormula("=MIN(A1:B2)", cells)).toBe("2");
    expect(evaluateFormula("=MAX(A1:B2)", cells)).toBe("5");
  });

  it("aggregates ignore empty and non-numeric cells; COUNT counts numeric cells only", () => {
    const cells = { A1: "Pen", B1: "4", C1: "", A2: "8" };
    expect(evaluateFormula("=SUM(A1:B1)", cells)).toBe("4");
    expect(evaluateFormula("=COUNT(A1:B1)", cells)).toBe("1");
    expect(evaluateFormula("=SUM(A1:C1)", cells)).toBe("4");
    expect(evaluateFormula("=COUNT(A1:C1)", cells)).toBe("1");
    expect(evaluateFormula("=AVERAGE(A1:C1)", cells)).toBe("4");
    expect(evaluateFormula("=MIN(A1:C1)", cells)).toBe("4");
    expect(evaluateFormula("=MAX(A1:C1)", cells)).toBe("4");
    expect(evaluateFormula("=SUM(A1:B2)", cells)).toBe("12");
    expect(evaluateFormula("=COUNT(A1:B2)", cells)).toBe("2");
  });

  it("supports value lists, nested formulas and nested calls", () => {
    const cells = { A1: "2", B1: "3" };
    expect(evaluateFormula("=SUM(1, A1, B1)", cells)).toBe("6");
    expect(evaluateFormula("=SUM(A1:B1)*2+1", cells)).toBe("11");
    expect(evaluateFormula("=SUM(MAX(A1:B1), MIN(A1:B1))", cells)).toBe("5");
  });

  it("returns errors for division by zero, text in arithmetic and circular references", () => {
    expect(evaluateFormula("=1/0", {})).toBe("#DIV/0!");
    expect(evaluateFormula("=A1+1", { A1: "Pen" })).toBe("#ERROR!");
    const circular = { A1: "=B1", B1: "=A1" };
    expect(evaluateFormula("=A1", circular)).toBe("#ERROR!");
  });

  it("passes through literal error tokens and propagates errors inside aggregate ranges", () => {
    expect(evaluateFormula("=#REF!", {})).toBe("#REF!");
    const cells = { A1: "=#REF!", B1: "2" };
    expect(evaluateFormula("=SUM(A1:B1)", cells)).toBe("#REF!");
  });

  it("formula cells display their result while ordinary cells display their text", () => {
    const cells = { A1: "Item", B1: "=2+3", C1: "TRUE", D1: "2024-01-01" };
    const display = computeDisplayCells(cells);
    expect(display.A1).toBe("Item");
    expect(display.B1).toBe("5");
    expect(display.C1).toBe("TRUE");
    expect(display.D1).toBe("2024-01-01");
  });
});

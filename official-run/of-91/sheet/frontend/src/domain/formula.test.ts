import { describe, expect, test } from "vitest";

import { computeDisplayValues, formatNumber } from "./formula";

describe("computeDisplayValues", () => {
  test("keeps ordinary text and numeric text unchanged", () => {
    const cells = { A1: "Region", B1: "1200", C1: "Open" };
    expect(computeDisplayValues(cells)).toEqual({ A1: "Region", B1: "1200", C1: "Open" });
  });

  test("calculates arithmetic, cell references and the aggregate functions", () => {
    const cells = {
      A1: "2",
      B1: "3",
      C1: "=A1+B1",
      D1: "=C1*2",
      E1: "=(A1+B1)/2",
      F1: "=-A1",
      A2: "=SUM(A1:B1)",
      B2: "=AVERAGE(A1:B1)",
      C2: "=COUNT(A1:B1)",
      D2: "=MIN(A1:B1)",
      E2: "=max(a1:b1)",
      F2: "=SUM(A1:B1)+C1",
    };
    const values = computeDisplayValues(cells);
    expect(values.C1).toBe("5");
    expect(values.D1).toBe("10");
    expect(values.E1).toBe("2.5");
    expect(values.F1).toBe("-2");
    expect(values.A2).toBe("5");
    expect(values.B2).toBe("2.5");
    expect(values.C2).toBe("2");
    expect(values.D2).toBe("2");
    expect(values.E2).toBe("3");
    expect(values.F2).toBe("10");
  });

  test("ignores empty and text cells in ranges and treats blanks as zero in arithmetic", () => {
    const cells = {
      A1: "2",
      B1: "",
      C1: "text",
      D1: "=SUM(A1:C1)",
      E1: "=A1+B1",
      F1: "=COUNT(A1:C1)",
      G1: "=AVERAGE(A1:C1)",
      H1: "=MIN(A1:C1)",
      I1: "=MAX(A1:C1)",
    };
    const values = computeDisplayValues(cells);
    expect(values.D1).toBe("2");
    expect(values.E1).toBe("2");
    expect(values.F1).toBe("1");
    expect(values.G1).toBe("2");
    expect(values.H1).toBe("2");
    expect(values.I1).toBe("2");
  });

  test("reports spreadsheet error codes instead of throwing", () => {
    const cells = {
      A1: "text",
      B1: "=1/0",
      C1: "=nope(1)",
      D1: "=(1+2",
      E1: "=A1+1",
      F1: "=F1+1",
      G1: "=A1:B1",
      H1: "=SUM(B9:B9)",
    };
    const values = computeDisplayValues(cells);
    expect(values.B1).toBe("#DIV/0!");
    expect(values.C1).toBe("#NAME?");
    expect(values.D1).toBe("#ERROR!");
    expect(values.E1).toBe("#VALUE!");
    expect(values.F1).toBe("#REF!");
    expect(values.G1).toBe("#VALUE!");
    expect(values.H1).toBe("0");
  });

  test("propagates a referenced formula result and its error", () => {
    const cells = { A1: "4", B1: "=A1*2", C1: "=B1+1", D1: "=1/0", E1: "=D1+1" };
    const values = computeDisplayValues(cells);
    expect(values.B1).toBe("8");
    expect(values.C1).toBe("9");
    expect(values.E1).toBe("#DIV/0!");
  });

  test("renders a #REF! marker from a row or column deletion as the reference error", () => {
    const values = computeDisplayValues({ A1: "=#REF!", B1: "=A2+#REF!" });
    expect(values.A1).toBe("#REF!");
    expect(values.B1).toBe("#REF!");
  });

  test("renders a bare reference to a text cell as that text", () => {
    const cells = {
      A1: "Item",
      B1: "1200",
      C1: "=A1",
      D1: "=B1",
      E1: "=C1",
      F1: "=A9",
      G1: "=A1+1",
      A2: "=A1",
      B2: "=C1",
    };
    const values = computeDisplayValues(cells);
    // The referenced value is shown as-is, including text and numeric text.
    expect(values.C1).toBe("Item");
    expect(values.D1).toBe("1200");
    // A reference to a formula cell follows its result, even when it is text.
    expect(values.E1).toBe("Item");
    // A blank reference keeps the blank-is-zero rule arithmetic uses.
    expect(values.F1).toBe("0");
    expect(values.A2).toBe("Item");
    expect(values.B2).toBe("Item");
    // Text inside arithmetic is still an error.
    expect(values.G1).toBe("#VALUE!");
  });

  test("aggregates a contiguous range with blanks, text and case-insensitive names", () => {
    // B2:B6 holds three numbers, one blank and one text cell, and C2 is a
    // formula forwarding a text cell; none of them is treated as zero.
    const cells = {
      B2: "1200",
      B3: "800",
      B4: "",
      B5: "700",
      B6: "n/a",
      C2: "=B6",
      D1: "=SUM(B2:B6)",
      D2: "=sum(b2:b6)",
      D3: "=AVERAGE(B2:B6)",
      D4: "=COUNT(B2:B6)",
      D5: "=MIN(B2:B6)",
      D6: "=MAX(B2:B6)",
      E1: "=SUM(B2:B6,C2)",
      E2: "=SUM(B2:B6)+COUNT(B2:B6)",
      E3: "=AVERAGE(B2:B6,700)",
    };
    const values = computeDisplayValues(cells);
    expect(values.D1).toBe("2700");
    expect(values.D2).toBe("2700");
    expect(values.D3).toBe("900");
    expect(values.D4).toBe("3");
    expect(values.D5).toBe("700");
    expect(values.D6).toBe("1200");
    expect(values.E1).toBe("2700");
    expect(values.E2).toBe("2703");
    expect(values.E3).toBe("850");
  });

  test("recalculates direct and indirect dependents from the current source values", () => {
    const before = { A1: "2", B1: "3", C1: "=A1+B1", D1: "=C1*2", E1: "=D1+1" };
    const after = { ...before, A1: "10" };
    expect(computeDisplayValues(before).E1).toBe("11");
    expect(computeDisplayValues(after).C1).toBe("13");
    expect(computeDisplayValues(after).D1).toBe("26");
    expect(computeDisplayValues(after).E1).toBe("27");
  });

  test("keeps an erroneous formula isolated from unrelated cells", () => {
    const cells = {
      A1: "4",
      B1: "=1/0",
      C1: "=B1+1",
      D1: "=A1*2",
      E1: "=SUM(D1:D1)",
      F1: "=SUM(A1:B1)",
    };
    const values = computeDisplayValues(cells);
    expect(values.B1).toBe("#DIV/0!");
    expect(values.C1).toBe("#DIV/0!");
    expect(values.D1).toBe("8");
    expect(values.E1).toBe("8");
    // Only the aggregate that covers the error cell propagates it.
    expect(values.F1).toBe("#DIV/0!");
  });

  test("treats address-shaped tokens that are not valid cells as #REF!", () => {
    const cells = {
      A1: "=A0",
      B1: "=$A$0",
      C1: "=AAAA1",
      D1: "=A1:A0",
      E1: "=FOO",
      F1: "=nolimit",
      G1: "=SUM(A1:A0)",
    };
    const values = computeDisplayValues(cells);
    // Out-of-range rows, over-long columns and a bad range end are broken
    // references, kept distinct from an unknown bare name.
    expect(values.A1).toBe("#REF!");
    expect(values.B1).toBe("#REF!");
    expect(values.C1).toBe("#REF!");
    expect(values.D1).toBe("#REF!");
    expect(values.G1).toBe("#REF!");
    // Names that are not address-shaped remain unsupported names.
    expect(values.E1).toBe("#NAME?");
    expect(values.F1).toBe("#NAME?");
  });

  test("uses the stable error codes for unsupported functions and circular references", () => {
    const cells = {
      A1: "2",
      B1: "=FOO(1)",
      C1: "=SUM(A1:A1",
      D1: "=A1/0",
      E1: "=#REF!",
      F1: "=G1",
      G1: "=F1",
      H1: "=H1+1",
      I1: "=A1*2",
    };
    const values = computeDisplayValues(cells);
    // An unsupported function, a malformed expression and division by zero.
    expect(values.B1).toBe("#NAME?");
    expect(values.C1).toBe("#ERROR!");
    expect(values.D1).toBe("#DIV/0!");
    // A reference marker, an indirect and a direct circular reference.
    expect(values.E1).toBe("#REF!");
    expect(values.F1).toBe("#REF!");
    expect(values.G1).toBe("#REF!");
    expect(values.H1).toBe("#REF!");
    // The errors stay isolated from an unrelated cell.
    expect(values.I1).toBe("4");
  });

  test("a formula fixed from an error recalculates itself and its dependents", () => {
    const broken = { A1: "2", B1: "=A1/0", C1: "=B1+1" };
    const fixed = { ...broken, B1: "=A1*3" };
    expect(computeDisplayValues(broken).B1).toBe("#DIV/0!");
    expect(computeDisplayValues(broken).C1).toBe("#DIV/0!");
    expect(computeDisplayValues(fixed).B1).toBe("6");
    expect(computeDisplayValues(fixed).C1).toBe("7");
  });

  test("formats calculated numbers without floating point noise", () => {
    expect(formatNumber(3)).toBe("3");
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(10 / 4)).toBe("2.5");
    expect(computeDisplayValues({ A1: "=0.1+0.2" }).A1).toBe("0.3");
  });
});
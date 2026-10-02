import { describe, expect, it } from "vitest";

import { cellDisplayText, displayValues } from "./formula";
import type { Worksheet } from "./workbook";

function sheet(cells: Record<string, string>): Worksheet {
  return { id: "ws", name: "Sheet1", rowCount: 50, columnCount: 26, cells };
}

describe("formula display values", () => {
  it("shows ordinary values exactly as entered and leaves the stored text alone", () => {
    const worksheet = sheet({
      A1: "Item/Qty",
      A2: "Pen",
      B2: "4",
      C2: "true",
      D2: "2026-09-01",
    });
    expect(displayValues(worksheet)).toEqual({
      A1: "Item/Qty",
      A2: "Pen",
      B2: "4",
      C2: "true",
      D2: "2026-09-01",
    });
    expect(worksheet.cells.A1).toBe("Item/Qty");
  });

  it("evaluates arithmetic, parentheses and unary minus", () => {
    expect(cellDisplayText(sheet({ A1: "=(1+2)*3-4/2" }), "A1")).toBe("7");
    expect(cellDisplayText(sheet({ A1: "=-2.5+1" }), "A1")).toBe("-1.5");
    expect(cellDisplayText(sheet({ A1: "=10/4" }), "A1")).toBe("2.5");
  });

  it("reads other cells including their calculated results", () => {
    const worksheet = sheet({ A1: "=1+1", B1: "=A1*3", C1: "=B1+A1" });
    expect(displayValues(worksheet)).toEqual({ A1: "2", B1: "6", C1: "8" });
  });

  it("aggregates ranges with SUM, AVERAGE, COUNT, MIN and MAX over numeric cells only", () => {
    const worksheet = sheet({
      A1: "Item",
      B1: "2",
      A2: "text",
      B2: "4",
      B3: "6",
      C3: "",
      D1: "=SUM(B1:B3)",
      D2: "=AVERAGE(B1:B3)",
      D3: "=COUNT(A1:B3)",
      D4: "=MIN(B1:B3)",
      D5: "=MAX(B1:B3)",
    });
    const values = displayValues(worksheet);
    expect(values.D1).toBe("12");
    expect(values.D2).toBe("4");
    // COUNT counts numeric cells only: B1, B2 and B3.
    expect(values.D3).toBe("3");
    expect(values.D4).toBe("2");
    expect(values.D5).toBe("6");
  });

  it("treats blanks as zero in arithmetic but ignores them in aggregates", () => {
    expect(cellDisplayText(sheet({ A1: "=B1+5" }), "A1")).toBe("5");
    expect(cellDisplayText(sheet({ A1: "=SUM(B1:B3)" }), "A1")).toBe("0");
    expect(cellDisplayText(sheet({ A1: "=AVERAGE(B1:B3)" }), "A1")).toBe("#DIV/0!");
  });

  it("accepts lower-case function names and extra arguments", () => {
    expect(cellDisplayText(sheet({ A1: "=sum(1,2,3)" }), "A1")).toBe("6");
    expect(cellDisplayText(sheet({ A1: "=max(4,B9)" }), "A1")).toBe("4");
  });

  it("reads absolute references like the cell they name (REQ-3-2-1 copies them)", () => {
    expect(cellDisplayText(sheet({ A1: "=$B$2+1", B2: "1200" }), "A1")).toBe("1201");
    expect(cellDisplayText(sheet({ A1: "=B$2*$B2", B2: "3" }), "A1")).toBe("9");
    expect(cellDisplayText(sheet({ A1: "=SUM($B$1:$B$3)", B1: "1", B2: "2", B3: "3" }), "A1")).toBe("6");
  });

  it("reports an explicit error instead of a silent wrong result", () => {
    expect(cellDisplayText(sheet({ A1: "=1/0" }), "A1")).toBe("#DIV/0!");
    expect(cellDisplayText(sheet({ A1: "=B1+1" , B1: "Pen" }), "A1")).toBe("#VALUE!");
    expect(cellDisplayText(sheet({ A1: "=NOPE(1)" }), "A1")).toBe("#NAME?");
    expect(cellDisplayText(sheet({ A1: "=1+" }), "A1")).toBe("#ERROR!");
  });

  it("stops a circular reference with #REF! and still shows the other cells", () => {
    const worksheet = sheet({ A1: "=B1+1", B1: "=A1+1", C1: "5" });
    const values = displayValues(worksheet);
    expect(values.A1).toBe("#REF!");
    expect(values.B1).toBe("#REF!");
    expect(values.C1).toBe("5");
  });

  it("propagates a source error through a dependent aggregate", () => {
    const worksheet = sheet({ A1: "=1/0", B1: "=SUM(A1:A2)" });
    expect(displayValues(worksheet).B1).toBe("#DIV/0!");
  });

  it("ignores empty and text cells in aggregate ranges instead of reading them as zero", () => {
    const worksheet = sheet({
      A1: "",
      A2: "   ",
      A3: "Item",
      A4: "4",
      B1: "=SUM(A1:A4)",
      B2: "=COUNT(A1:A4)",
      B3: "=AVERAGE(A1:A4)",
      B4: "=MIN(A1:A4)",
      B5: "=MAX(A1:A4)",
    });
    const values = displayValues(worksheet);
    expect(values.B1).toBe("4");
    expect(values.B2).toBe("1");
    expect(values.B3).toBe("4");
    expect(values.B4).toBe("4");
    expect(values.B5).toBe("4");
  });

  it("uses only numeric cells when a function reads single references", () => {
    const worksheet = sheet({ A1: "Item", A2: "=SUM(A1)", A3: "=COUNT(A1)", A4: "=SUM(A9)", A5: "=AVERAGE(A1)" });
    const values = displayValues(worksheet);
    expect(values.A2).toBe("0");
    expect(values.A3).toBe("0");
    expect(values.A4).toBe("0");
    expect(values.A5).toBe("#DIV/0!");
  });

  it("evaluates a seeded formula chain and recalculates it from the current source values", () => {
    const seeded = sheet({ A1: "2", B1: "3", C1: "=A1+B1", D1: "=C1*2" });
    expect(displayValues(seeded)).toEqual({ A1: "2", B1: "3", C1: "5", D1: "10" });
    const edited = sheet({ A1: "5", B1: "3", C1: "=A1+B1", D1: "=C1*2" });
    expect(displayValues(edited)).toEqual({ A1: "5", B1: "3", C1: "8", D1: "16" });
  });

  it("reports an invalid reference as #REF! and keeps error literals inside formulas", () => {
    expect(cellDisplayText(sheet({ A1: "=A0+1" }), "A1")).toBe("#REF!");
    expect(cellDisplayText(sheet({ A1: "=#REF!" }), "A1")).toBe("#REF!");
    expect(cellDisplayText(sheet({ A1: "=#REF!+1" }), "A1")).toBe("#REF!");
    expect(cellDisplayText(sheet({ A1: "=SUM(#REF!)" }), "A1")).toBe("#REF!");
    // A name that runs into digits but is called is an unsupported function.
    expect(cellDisplayText(sheet({ A1: "=LOG10(100)" }), "A1")).toBe("#NAME?");
    expect(cellDisplayText(sheet({ A1: "=DIV/0!" }), "A1")).toBe("#ERROR!");
  });

  it("treats a coordinate outside the sheet as an invalid reference, not a blank 0", () => {
    // `E1` is inside the 50x26 test sheet; `ZZZ99999`, `AA1` (beyond column Z)
    // and `A51` (beyond row 50) are not, and must not silently read as 0.
    const worksheet = sheet({ A1: "2", B1: "3", E1: "=ZZZ99999", E2: "=A51+1", E3: "=AA1*2" });
    const values = displayValues(worksheet);
    expect(values.E1).toBe("#REF!");
    expect(values.E2).toBe("#REF!");
    expect(values.E3).toBe("#REF!");
    // A reference to a blank cell inside the sheet still reads as 0.
    expect(cellDisplayText(worksheet, "E4")).toBe("");
    expect(cellDisplayText(sheet({ A1: "=Z50+5", Z50: "" }), "A1")).toBe("5");
    // A range endpoint outside the sheet is invalid too.
    expect(cellDisplayText(sheet({ A1: "=SUM(A1:AA2)" }), "A1")).toBe("#REF!");
  });

  it("isolates one error cell from unrelated formulas", () => {
    const worksheet = sheet({ A1: "=1/0", B1: "=2+3", C1: "=SUM(B1:B1)" });
    const values = displayValues(worksheet);
    expect(values.A1).toBe("#DIV/0!");
    expect(values.B1).toBe("5");
    expect(values.C1).toBe("5");
  });
});

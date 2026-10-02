import { describe, expect, it } from "vitest";

import {
  clipboardMatchesText,
  readRegion,
  tableToTsv,
  targetRegion,
  transferCells,
  translateFormula,
  type RangeClipboard,
} from "./range-transfer";
import type { Worksheet } from "./workbook";

function sheet(cells: Record<string, string> = {}): Worksheet {
  return { id: "ws", name: "Sheet1", rowCount: 20, columnCount: 8, cells };
}

function clipboard(cells: Record<string, string>, region: RangeClipboard["region"], mode: RangeClipboard["mode"]): RangeClipboard {
  return {
    workbookId: "q3-sales",
    worksheetId: "ws",
    mode,
    region,
    table: readRegion(sheet(cells), region),
  };
}

describe("range transfer", () => {
  it("shifts relative references by the target offset and keeps absolute ones", () => {
    expect(translateFormula("=B2*2", 1, 0)).toBe("=B3*2");
    expect(translateFormula("=B2*2", 0, 2)).toBe("=D2*2");
    expect(translateFormula("=$B$2*2", 3, 4)).toBe("=$B$2*2");
    expect(translateFormula("=SUM(A1:B2)", 2, 2)).toBe("=SUM(C3:D4)");
    expect(translateFormula("=$A1+B$2", 1, 1)).toBe("=$A2+C$2");
    // Values that are not formulas stay exactly as typed.
    expect(translateFormula("East", 3, 3)).toBe("East");
  });

  it("writes =#REF! when the offset pushes a relative reference outside the sheet", () => {
    expect(translateFormula("=A1+1", -1, 0)).toBe("=#REF!");
    expect(translateFormula("=A1+1", 0, -1)).toBe("=#REF!");
    // A formula that is only a relative reference becomes `=#REF!` as well, so
    // the target formula bar shows `=#REF!` and the grid shows `#REF!`.
    expect(translateFormula("=A1", -1, 0)).toBe("=#REF!");
    expect(translateFormula("=B2", 0, -2)).toBe("=#REF!");
    // An absolute reference is never adjusted, so it cannot leave the sheet.
    expect(translateFormula("=$A$1", -5, -5)).toBe("=$A$1");
    expect(translateFormula("=$B$2+1", -5, -5)).toBe("=$B$2+1");
  });

  it("moves a rectangle reference as one unit and keeps absolute endpoints", () => {
    expect(translateFormula("=SUM($A$1:$A$3)", 4, 0)).toBe("=SUM($A$1:$A$3)");
    expect(translateFormula("=SUM(A1:B2)", -1, 0)).toBe("=#REF!");
    expect(translateFormula("=SUM(A1:B2)", 0, -1)).toBe("=#REF!");
    // A range whose start stays inside the sheet while the offset moves the
    // other endpoint is translated in full.
    expect(translateFormula("=SUM(B2:B4)", -1, -1)).toBe("=SUM(A1:A3)");
  });

  it("reads a rectangle row-major and reports its tab-separated text", () => {
    const worksheet = sheet({ A1: "Item", B1: "Qty", A2: "Pen", B2: "4" });
    const region = { minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 };
    const table = readRegion(worksheet, region);
    expect(table).toEqual([["Item", "Qty"], ["Pen", "4"]]);
    expect(tableToTsv(table)).toBe("Item\tQty\nPen\t4");
  });

  it("writes the whole target rectangle with translated formulas and keeps the source", () => {
    const clip = clipboard({ C1: "=B1*2", D1: "5" }, { minRow: 0, maxRow: 0, minCol: 2, maxCol: 3 }, "copy");
    const cells = transferCells(clip, { row: 1, col: 2 });
    expect(cells).toEqual({ C2: "=B2*2", D2: "5" });
    expect(targetRegion(clip, { row: 1, col: 2 })).toEqual({
      minRow: 1,
      maxRow: 1,
      minCol: 2,
      maxCol: 3,
    });
  });

  it("measures the offset from the source rectangle, not from the sheet origin", () => {
    const clip = clipboard(
      { A3: "=A1+1", B3: "=SUM(A1:A2)" },
      { minRow: 2, maxRow: 2, minCol: 0, maxCol: 1 },
      "copy",
    );
    // Pasting one row below the source shifts every relative reference by one.
    expect(transferCells(clip, { row: 3, col: 0 })).toEqual({ A4: "=A2+1", B4: "=SUM(A2:A3)" });
    // Pasting onto the source itself keeps the formulas as they are.
    expect(transferCells(clip, { row: 2, col: 0 })).toEqual({ A3: "=A1+1", B3: "=SUM(A1:A2)" });
  });

  it("clears the cut source in the same patch and keeps cells covered by the target", () => {
    const clip = clipboard(
      { A1: "Item", B1: "Qty", A2: "Pen", B2: "4" },
      { minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 },
      "cut",
    );
    const cells = transferCells(clip, { row: 0, col: 2 });
    expect(cells).toEqual({
      A1: null,
      B1: null,
      A2: null,
      B2: null,
      C1: "Item",
      D1: "Qty",
      C2: "Pen",
      D2: "4",
    });

    // A move onto an overlapping rectangle clears only the source cells the
    // target does not cover.
    const overlapping = transferCells(clip, { row: 1, col: 0 });
    expect(overlapping).toEqual({ A1: null, B1: null, A2: "Item", B2: "Qty", A3: "Pen", B3: "4" });
  });

  it("clears empty target cells and matches its own clipboard text", () => {
    const clip = clipboard({ A1: "1", A2: "", B2: "2" }, { minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 }, "copy");
    expect(transferCells(clip, { row: 0, col: 3 })).toEqual({ D1: "1", E1: null, D2: null, E2: "2" });
    expect(clipboardMatchesText(clip, "1\t\n\t2")).toBe(true);
    expect(clipboardMatchesText(clip, "1\t2")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import {
  cellCoordinate,
  columnLabel,
  isCellCoordinate,
  isCellInRange,
  normalizeRange,
  parseCellCoordinate,
} from "./spreadsheet";

describe("cell coordinates", () => {
  it("maps between letters and indexes", () => {
    expect(columnLabel(0)).toBe("A");
    expect(columnLabel(25)).toBe("Z");
    expect(columnLabel(26)).toBe("AA");
    expect(cellCoordinate(0, 0)).toBe("A1");
    expect(cellCoordinate(2, 1)).toBe("B3");
  });

  it("parses coordinates and rejects invalid ones", () => {
    expect(parseCellCoordinate("B3")).toEqual({ row: 2, column: 1 });
    expect(parseCellCoordinate("A0")).toBeNull();
    expect(parseCellCoordinate("1A")).toBeNull();
    expect(isCellCoordinate("AA10")).toBe(true);
    expect(isCellCoordinate("a1")).toBe(false);
  });
});

describe("rectangular ranges", () => {
  it("normalizes a dragged rectangle from either corner", () => {
    expect(normalizeRange({ anchor: "B2", focus: "A1" })).toEqual({
      minRow: 0, maxRow: 1, minColumn: 0, maxColumn: 1,
    });
  });

  it("only marks cells inside the rectangle as selected", () => {
    const range = normalizeRange({ anchor: "A1", focus: "B2" });
    expect(["A1", "B1", "A2", "B2"].every((cell) => isCellInRange(range, cell))).toBe(true);
    expect(isCellInRange(range, "C1")).toBe(false);
    expect(isCellInRange(range, "A3")).toBe(false);
  });
});

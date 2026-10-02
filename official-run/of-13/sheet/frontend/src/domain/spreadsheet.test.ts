import { describe, expect, it } from "vitest";

import {
  SHEET_COLUMN_COUNT,
  SHEET_ROW_COUNT,
  cellAddress,
  clampAddress,
  columnName,
  isCellSelected,
  parseAddress,
  selectionBounds,
  shiftAddress,
} from "./spreadsheet";

describe("cell coordinates", () => {
  it("names columns and cells", () => {
    expect(columnName(0)).toBe("A");
    expect(columnName(25)).toBe("Z");
    expect(columnName(26)).toBe("AA");
    expect(cellAddress(0, 0)).toBe("A1");
    expect(cellAddress(9, 3)).toBe("D10");
  });

  it("parses addresses case-insensitively", () => {
    expect(parseAddress("b3")).toEqual({ row: 2, column: 1 });
    expect(parseAddress("A1")).toEqual({ row: 0, column: 0 });
    expect(parseAddress("1A")).toBeNull();
    expect(parseAddress("")).toBeNull();
  });

  it("clamps addresses to the grid bounds", () => {
    expect(clampAddress("A0")).toBe("A1");
    expect(clampAddress("ZZ" + String(SHEET_ROW_COUNT + 5))).toBe(cellAddress(SHEET_ROW_COUNT - 1, SHEET_COLUMN_COUNT - 1));
    expect(clampAddress("nonsense")).toBe("A1");
  });

  it("moves within the grid", () => {
    expect(shiftAddress("A1", 1, 0)).toBe("A2");
    expect(shiftAddress("A1", 0, 1)).toBe("B1");
    expect(shiftAddress("A1", -1, 0)).toBe("A1");
    expect(shiftAddress("A1", 0, -1)).toBe("A1");
  });
});

describe("rectangular selection", () => {
  it("normalizes the selected region regardless of drag direction", () => {
    expect(selectionBounds({ start: "D5", end: "B2" })).toEqual({ top: 1, bottom: 4, left: 1, right: 3 });
  });

  it("marks cells inside the region and only those", () => {
    const selection = { start: "A1", end: "B2" };
    expect(isCellSelected("A1", selection)).toBe(true);
    expect(isCellSelected("B2", selection)).toBe(true);
    expect(isCellSelected("A2", selection)).toBe(true);
    expect(isCellSelected("C1", selection)).toBe(false);
    expect(isCellSelected("A3", selection)).toBe(false);
  });

  it("selects a single cell region", () => {
    const selection = { start: "C3", end: "C3" };
    expect(isCellSelected("C3", selection)).toBe(true);
    expect(isCellSelected("C2", selection)).toBe(false);
  });
});

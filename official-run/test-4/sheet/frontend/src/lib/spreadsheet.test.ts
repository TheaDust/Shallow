import { describe, expect, it } from "vitest";

import {
  cellName,
  columnName,
  formatDateTime,
  gridSize,
  normalizeRange,
  parseCoord,
  parsePasteText,
  rangeContains,
} from "./spreadsheet";

describe("coordinate helpers", () => {
  it("names columns and cells", () => {
    expect(columnName(0)).toBe("A");
    expect(columnName(25)).toBe("Z");
    expect(columnName(26)).toBe("AA");
    expect(cellName(1, 0)).toBe("A1");
    expect(cellName(3, 27)).toBe("AB3");
  });

  it("parses coordinates back", () => {
    expect(parseCoord("A1")).toEqual({ row: 1, col: 0 });
    expect(parseCoord("AB12")).toEqual({ row: 12, col: 27 });
    expect(parseCoord("invalid")).toBeNull();
    expect(parseCoord("A0")).toBeNull();
  });

  it("computes grid size from used cells with defaults", () => {
    expect(gridSize({})).toEqual({ rows: 50, cols: 26 });
    expect(gridSize({ A1: "x", B3: "y" })).toEqual({ rows: 50, cols: 26 });
    expect(gridSize({ AA12: "x" })).toEqual({ rows: 50, cols: 27 });
    expect(gridSize({ A100: "x" })).toEqual({ rows: 100, cols: 26 });
  });
});

describe("formatDateTime", () => {
  it("formats an ISO timestamp", () => {
    const formatted = formatDateTime("2026-09-27T16:31:00.000Z");
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(formatted.includes("2026-09-27")).toBe(true);
  });
});

describe("normalizeRange and rangeContains", () => {
  it("normalizes a dragged range to its corners", () => {
    expect(normalizeRange("A1", "C3")).toEqual({ start: "A1", end: "C3" });
    expect(normalizeRange("C3", "A1")).toEqual({ start: "A1", end: "C3" });
    expect(normalizeRange("B2", "B2")).toEqual({ start: "B2", end: "B2" });
  });

  it("checks membership inside a rectangle", () => {
    const range = { start: "A1", end: "C3" };
    expect(rangeContains("A1", range)).toBe(true);
    expect(rangeContains("C3", range)).toBe(true);
    expect(rangeContains("B2", range)).toBe(true);
    expect(rangeContains("D1", range)).toBe(false);
    expect(rangeContains("A4", range)).toBe(false);
  });
});

describe("parsePasteText", () => {
  it("splits rows and columns preserving empty fields", () => {
    expect(parsePasteText("East\t1200\nNorth\t800")).toEqual([
      ["East", "1200"],
      ["North", "800"],
    ]);
  });

  it("preserves empty fields within rows and empty interior rows", () => {
    expect(parsePasteText("a\t\tb\n\nc\t3")).toEqual([
      ["a", "", "b"],
      [""],
      ["c", "3"],
    ]);
  });

  it("ignores a single trailing newline", () => {
    expect(parsePasteText("East\t1200\nNorth\t800\n")).toEqual([
      ["East", "1200"],
      ["North", "800"],
    ]);
  });

  it("handles CRLF line endings", () => {
    expect(parsePasteText("a\t1\r\nb\t2\r\n")).toEqual([
      ["a", "1"],
      ["b", "2"],
    ]);
  });
});

import { describe, expect, it } from "vitest";

import {
  activeCellName,
  cellDisplayText,
  cellName,
  columnLabel,
  formatTimestamp,
  isCellInSelection,
  lastUpdatedText,
  parseCellName,
  selectionBounds,
  type Worksheet,
} from "./types";

describe("spreadsheet coordinates", () => {
  it("labels columns and cells", () => {
    expect(columnLabel(0)).toBe("A");
    expect(columnLabel(25)).toBe("Z");
    expect(columnLabel(26)).toBe("AA");
    expect(cellName(0, 0)).toBe("A1");
    expect(cellName(29, 25)).toBe("Z30");
  });

  it("parses coordinates, including multi-letter columns", () => {
    expect(parseCellName("A1")).toEqual({ row: 0, column: 0 });
    expect(parseCellName("aa12")).toEqual({ row: 11, column: 26 });
    expect(parseCellName("1A")).toBeNull();
    expect(parseCellName("A0")).toBeNull();
  });
});

describe("workbook timestamps", () => {
  it("formats a stable shared text", () => {
    expect(formatTimestamp("2026-10-01T08:00:00.000Z")).toBe("2026-10-01 08:00");
    expect(lastUpdatedText("2026-10-01T08:00:00.000Z")).toBe("Last updated: 2026-10-01 08:00");
  });

  it("falls back to the raw value for unparseable input", () => {
    expect(formatTimestamp("not-a-date")).toBe("not-a-date");
  });
});

describe("selection", () => {
  it("tracks the selected rectangular region", () => {
    expect(isCellInSelection({ anchor: "A1", focus: "A1" }, 0, 0)).toBe(true);
    expect(isCellInSelection({ anchor: "A1", focus: "A1" }, 0, 1)).toBe(false);
    expect(isCellInSelection({ anchor: "B2", focus: "C3" }, 1, 2)).toBe(true);
    expect(isCellInSelection({ anchor: "C3", focus: "B2" }, 1, 1)).toBe(true);
    expect(isCellInSelection({ anchor: "C3", focus: "B2" }, 3, 1)).toBe(false);
    expect(selectionBounds({ anchor: "C3", focus: "B2" })).toEqual({ top: 1, left: 1, bottom: 2, right: 2 });
  });
});

describe("worksheet values", () => {
  const worksheet: Worksheet = {
    id: "ws-1",
    name: "Sheet1",
    rowCount: 4,
    columnCount: 3,
    cells: { A1: { value: "Region" }, B1: { value: "1200" } },
    selection: { anchor: "A1", focus: "B1" },
  };

  it("reads the active cell and displayed text", () => {
    expect(activeCellName(worksheet)).toBe("B1");
    expect(cellDisplayText(worksheet, "A1")).toBe("Region");
    expect(cellDisplayText(worksheet, "C9")).toBe("");
  });
});

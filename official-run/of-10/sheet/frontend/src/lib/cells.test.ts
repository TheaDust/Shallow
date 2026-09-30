import { describe, expect, it } from "vitest";

import { clampCell, columnIndexToLabel, columnLabelToIndex, isInRegion, makeCellId, parseCellId, regionOf } from "./cells";
import { formatLastUpdated } from "../workbooks/format";

describe("cell coordinates", () => {
  it("converts between column labels and indexes", () => {
    expect(columnIndexToLabel(1)).toBe("A");
    expect(columnIndexToLabel(26)).toBe("Z");
    expect(columnIndexToLabel(27)).toBe("AA");
    expect(columnLabelToIndex("z")).toBe(26);
    expect(columnLabelToIndex("aa")).toBe(27);
    expect(columnLabelToIndex("1")).toBe(-1);
  });

  it("builds and parses cell ids", () => {
    expect(makeCellId(1, 1)).toBe("A1");
    expect(makeCellId(12, 28)).toBe("AB12");
    expect(parseCellId("B4")).toEqual({ row: 4, column: 2 });
    expect(parseCellId("nope")).toBeNull();
    expect(parseCellId("")).toBeNull();
  });

  it("describes rectangular selections", () => {
    const region = regionOf({ row: 3, column: 2 }, { row: 1, column: 4 });
    expect(region).toEqual({ top: 1, bottom: 3, left: 2, right: 4 });
    expect(isInRegion(region, { row: 2, column: 3 })).toBe(true);
    expect(isInRegion(region, { row: 4, column: 3 })).toBe(false);
    expect(isInRegion(region, { row: 2, column: 1 })).toBe(false);
  });

  it("clamps addresses inside the sheet bounds", () => {
    expect(clampCell({ row: 0, column: 0 }, 5, 5)).toEqual({ row: 1, column: 1 });
    expect(clampCell({ row: 9, column: 9 }, 5, 5)).toEqual({ row: 5, column: 5 });
  });
});

describe("last updated formatting", () => {
  it("renders the same value for one stored timestamp", () => {
    expect(formatLastUpdated("2026-09-28T10:15:00.000Z")).toBe("2026-09-28 10:15");
    expect(formatLastUpdated("not-a-date")).toBe("not-a-date");
  });
});

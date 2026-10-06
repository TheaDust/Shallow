import { describe, expect, test } from "vitest";

import { cellName, columnName, isInsideRegion, parseCellName, regionBetween, usedExtent } from "./grid";

describe("grid coordinates", () => {
  test("names columns and cells with A1 notation", () => {
    expect(columnName(1)).toBe("A");
    expect(columnName(26)).toBe("Z");
    expect(columnName(27)).toBe("AA");
    expect(cellName(1, 1)).toBe("A1");
    expect(cellName(12, 28)).toBe("AB12");
  });

  test("parses coordinates and rejects malformed names", () => {
    expect(parseCellName("A1")).toEqual({ row: 1, column: 1 });
    expect(parseCellName("ab12")).toEqual({ row: 12, column: 28 });
    expect(parseCellName("A0")).toBeNull();
    expect(parseCellName("")).toBeNull();
  });

  test("builds the rectangular region between anchor and focus regardless of order", () => {
    const region = regionBetween("C4", "A2");
    expect(region).toEqual({ top: 2, left: 1, bottom: 4, right: 3 });
    expect(isInsideRegion(3, 2, region)).toBe(true);
    expect(isInsideRegion(1, 1, region)).toBe(false);
    expect(isInsideRegion(4, 4, region)).toBe(false);
  });

  test("reports the extent a worksheet actually uses", () => {
    expect(usedExtent({})).toEqual({ rows: 0, columns: 0 });
    expect(usedExtent({ B2: "x", L40: "y", C7: "z" })).toEqual({ rows: 40, columns: 12 });
  });
});

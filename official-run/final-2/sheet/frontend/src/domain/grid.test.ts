import { describe, expect, test } from "vitest";

import { cellName, columnName, isInsideRegion, parseCellName, regionBetween, rowRecordText } from "./grid";

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

  test("joins the values of one row into its record text", () => {
    const values = { D4: "Atlas", E4: "Queued", F4: "17", H5: "solo" };
    expect(rowRecordText(values, 4, 12)).toBe("Atlas/Queued/17");
    // Values keep their column order even when they are not adjacent.
    expect(rowRecordText({ B9: "1", F9: "2" }, 9, 12)).toBe("1/2");
    // A lone value is already the text of its own cell, an empty row has none.
    expect(rowRecordText(values, 5, 12)).toBe("");
    expect(rowRecordText(values, 6, 12)).toBe("");
  });
});

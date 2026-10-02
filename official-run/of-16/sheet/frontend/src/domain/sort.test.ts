import { describe, expect, it } from "vitest";

import { seedWorkbook } from "../test/fake-backend";
import { regionHasHeaderRow, SORT_ORDERS, sortColumnOptions } from "./sort";
import { usedRegion } from "./filter";

const sheet = () => seedWorkbook().worksheets[0];

describe("sort options", () => {
  it("names the Sort by options after the header text of the range", () => {
    const region = usedRegion(sheet())!;
    expect(sortColumnOptions(sheet(), region)).toEqual([
      { value: "0", label: "Region" },
      { value: "1", label: "Sales" },
      { value: "2", label: "Status" },
    ]);
    // A column without header text falls back to its column label.
    const worksheet = sheet();
    delete worksheet.cells.C1;
    expect(sortColumnOptions(worksheet, region)[2]).toEqual({ value: "2", label: "C" });
  });

  it("offers the visible order names", () => {
    expect(SORT_ORDERS).toEqual([
      { value: "ascending", label: "Ascending" },
      { value: "descending", label: "Descending" },
    ]);
  });

  it("auto-detects a header row from a text-only first row", () => {
    const worksheet = sheet();
    const region = usedRegion(worksheet)!;
    expect(regionHasHeaderRow(worksheet, region)).toBe(true);
    // The data rows start with "East/1200/Open": numbers mark it as data.
    expect(regionHasHeaderRow(worksheet, { ...region, minRow: 1 })).toBe(false);
    // A single-row region has no header to keep out of the sort.
    expect(regionHasHeaderRow(worksheet, { minRow: 0, maxRow: 0, minCol: 0, maxCol: 2 })).toBe(false);
    // An empty region never claims a header row.
    expect(regionHasHeaderRow(worksheet, { minRow: 10, maxRow: 12, minCol: 0, maxCol: 2 })).toBe(false);
  });
});

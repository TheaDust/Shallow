/**
 * The sort helpers shared by the dialog and the test double: the type-aware comparison and the
 * naming of the `Sort by` options after the header text of the selected rectangle.
 */

import { describe, expect, it } from "vitest";

import {
  compareSortKeys,
  looksLikeHeaderRow,
  sortColumnOptions,
  type SortOrder,
} from "./sort";
import type { WorksheetState } from "./workbook";

const SHEET: WorksheetState = {
  id: "sheet-1",
  name: "Sheet1",
  cells: {
    A1: "Region",
    B1: "Sales",
    C1: "Status",
    A2: "East",
    B2: "1200",
    C2: "Open",
    A3: "North",
    B3: "800",
    C3: "Closed",
  },
  values: {
    A1: "Region",
    B1: "Sales",
    C1: "Status",
    A2: "East",
    B2: "1200",
    C2: "Open",
    A3: "North",
    B3: "800",
    C3: "Closed",
  },
};

function sorted(keys: string[], order: SortOrder): string[] {
  return [...keys].sort((left, right) => compareSortKeys(left, right, order));
}

describe("compareSortKeys", () => {
  it("compares numbers numerically and text alphabetically", () => {
    expect(sorted(["10", "2", "800"], "ascending")).toEqual(["2", "10", "800"]);
    expect(sorted(["10", "2", "800"], "descending")).toEqual(["800", "10", "2"]);
    expect(sorted(["North", "east", "South"], "ascending")).toEqual(["east", "North", "South"]);
  });

  it("compares parseable dates as dates", () => {
    expect(sorted(["2026-03-01", "2026-01-05", "2026-02-20"], "ascending")).toEqual([
      "2026-01-05",
      "2026-02-20",
      "2026-03-01",
    ]);
  });

  it("keeps numbers, dates and text in their type order and blanks last", () => {
    expect(sorted(["banana", "2026-03-01", "10", ""], "ascending")).toEqual([
      "10",
      "2026-03-01",
      "banana",
      "",
    ]);
    expect(sorted(["banana", "2026-03-01", "10", ""], "descending")).toEqual([
      "banana",
      "2026-03-01",
      "10",
      "",
    ]);
  });

  it("treats equal keys as equal so the stable sort keeps their order", () => {
    expect(compareSortKeys("Open", "Open", "ascending")).toBe(0);
    expect(compareSortKeys("Open", "Open", "descending")).toBe(0);
  });
});

describe("the dialog's options", () => {
  it("names every column of the rectangle after its header text", () => {
    expect(sortColumnOptions(SHEET, { start: "A1", end: "C4" })).toEqual([
      { value: "A", label: "Region" },
      { value: "B", label: "Sales" },
      { value: "C", label: "Status" },
    ]);
    // A single cell keeps its own text as the option name.
    expect(sortColumnOptions(SHEET, { start: "B2", end: "B2" })).toEqual([
      { value: "B", label: "1200" },
    ]);
  });

  it("starts with the header checkbox checked only for a text first row", () => {
    expect(looksLikeHeaderRow(SHEET, { start: "A1", end: "C3" })).toBe(true);
    // The data rows start with a number, so they are not a header row.
    expect(looksLikeHeaderRow(SHEET, { start: "A2", end: "C3" })).toBe(false);
    expect(looksLikeHeaderRow(SHEET, { start: "A1", end: "A1" })).toBe(false);
  });
});

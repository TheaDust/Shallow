import { describe, expect, it } from "vitest";

import {
  compareSortValues,
  isSortRange,
  sortColumnOptions,
  sortRangeRecords,
  sortValueKind,
} from "./sort";
import type { SortRangeSpec, Worksheet } from "./types";

function worksheet(cells: Record<string, string>, rowCount = 10, columnCount = 5): Worksheet {
  return {
    id: "sheet-1",
    name: "Sheet1",
    rowCount,
    columnCount,
    cells,
    selection: { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } },
    validations: [],
    filter: null,
  };
}

const SEED = {
  A1: "Region",
  B1: "Sales",
  C1: "Status",
  A2: "East",
  B2: "1200",
  C2: "Open",
  A3: "North",
  B3: "800",
  C3: "Closed",
  A4: "South",
  B4: "700",
  C4: "Open",
};

const range = { minRow: 0, maxRow: 3, minCol: 0, maxCol: 2 };

function spec(overrides: Partial<SortRangeSpec> = {}): SortRangeSpec {
  return { range, col: 1, order: "ascending", hasHeaderRow: true, ...overrides };
}

describe("sort keys", () => {
  it("classifies numbers, dates, text and blanks", () => {
    expect(sortValueKind("1200")).toBe("number");
    expect(sortValueKind("-2.5")).toBe("number");
    expect(sortValueKind("2024-01-05")).toBe("date");
    expect(sortValueKind("1/5/2024")).toBe("date");
    expect(sortValueKind("East")).toBe("text");
    expect(sortValueKind("  ")).toBe("blank");
  });

  it("compares values of the same type naturally and ranks other kinds", () => {
    expect(compareSortValues("700", "1200")).toBeLessThan(0);
    expect(compareSortValues("2024-01-05", "2024-01-01")).toBeGreaterThan(0);
    expect(compareSortValues("apple", "banana")).toBeLessThan(0);
    // Numbers, then dates, then text, then blanks — whatever the direction.
    expect(compareSortValues("2", "2024-01-01")).toBeLessThan(0);
    expect(compareSortValues("2024-01-01", "apple")).toBeLessThan(0);
    expect(compareSortValues("apple", "")).toBeLessThan(0);
    expect(compareSortValues("North", "North")).toBe(0);
  });

  it("recognizes usable ranges", () => {
    expect(isSortRange(range, 10, 5)).toBe(true);
    expect(isSortRange({ minRow: 0, maxRow: 99, minCol: 0, maxCol: 2 }, 10, 5)).toBe(false);
    expect(isSortRange({ minRow: 3, maxRow: 1, minCol: 0, maxCol: 2 }, 10, 5)).toBe(false);
    expect(isSortRange(null, 10, 5)).toBe(false);
  });
});

describe("sortRangeRecords", () => {
  it("names the columns of the selected range after its header row", () => {
    expect(sortColumnOptions(worksheet(SEED), range)).toEqual([
      { value: "0", label: "Region" },
      { value: "1", label: "Sales" },
      { value: "2", label: "Status" },
    ]);
    // An empty header cell falls back to the column letter.
    expect(sortColumnOptions(worksheet({ B1: "Sales" }), { minRow: 0, maxRow: 2, minCol: 0, maxCol: 1 })).toEqual([
      { value: "0", label: "A" },
      { value: "1", label: "Sales" },
    ]);
  });

  it("reorders the records by the chosen column and leaves the header row alone", () => {
    const result = sortRangeRecords(worksheet(SEED), spec());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.worksheet.cells).toEqual({
      A1: "Region",
      B1: "Sales",
      C1: "Status",
      A2: "South",
      B2: "700",
      C2: "Open",
      A3: "North",
      B3: "800",
      C3: "Closed",
      A4: "East",
      B4: "1200",
      C4: "Open",
    });
    // The original worksheet is never mutated.
    expect(worksheet(SEED).cells.A2).toBe("East");
  });

  it("sorts the first row as well when it is not a header", () => {
    const result = sortRangeRecords(
      worksheet(SEED),
      spec({ range: { minRow: 0, maxRow: 3, minCol: 1, maxCol: 1 }, hasHeaderRow: false }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(["B1", "B2", "B3", "B4"].map((key) => result.worksheet.cells[key])).toEqual([
      "700",
      "800",
      "1200",
      "Sales",
    ]);
    expect(result.worksheet.cells.A2).toBe("East");
  });

  it("never expands beyond the selected rectangle", () => {
    const result = sortRangeRecords(
      worksheet({ ...SEED, D2: "keep", E3: "keep" }),
      spec({ range: { minRow: 0, maxRow: 3, minCol: 1, maxCol: 1 } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.worksheet.cells.D2).toBe("keep");
    expect(result.worksheet.cells.E3).toBe("keep");
    expect(result.worksheet.cells.A2).toBe("East");
    expect(result.worksheet.cells.A4).toBe("South");
  });

  it("keeps equal keys in their original relative order", () => {
    const sheet = worksheet({
      A1: "Region",
      B1: "Sales",
      A2: "South",
      B2: "700",
      A3: "East",
      B3: "1200",
      A4: "North",
      B4: "700",
      A5: "West",
      B5: "700",
    });
    const result = sortRangeRecords(sheet, spec({ range: { minRow: 0, maxRow: 4, minCol: 0, maxCol: 1 } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(["A2", "A3", "A4", "A5"].map((key) => result.worksheet.cells[key])).toEqual([
      "South",
      "North",
      "West",
      "East",
    ]);
  });

  it("moves a formula with its record and follows the references inside the range", () => {
    const sheet = worksheet({
      A1: "Region",
      B1: "Sales",
      C1: "Computed",
      A2: "East",
      B2: "1200",
      C2: "=B2*2",
      A3: "South",
      B3: "700",
      C3: "=B3+1",
    });
    const result = sortRangeRecords(sheet, spec({ range: { minRow: 0, maxRow: 2, minCol: 0, maxCol: 2 } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cells = result.worksheet.cells;
    expect([cells.A2, cells.A3]).toEqual(["South", "East"]);
    // South lands on row 2 and East on row 3, yet each formula keeps reading
    // the sales value of its own record.
    expect(cells.C2).toBe("=B2+1");
    expect(cells.C3).toBe("=B3*2");
  });

  it("rejects a range, a column or an order it cannot apply", () => {
    const sheet = worksheet(SEED);
    expect(sortRangeRecords(sheet, spec({ range: { minRow: 0, maxRow: 99, minCol: 0, maxCol: 2 } }))).toEqual({
      ok: false,
      error: "Invalid sort range",
    });
    expect(sortRangeRecords(sheet, spec({ col: 4 }))).toEqual({
      ok: false,
      error: "The sort column is outside the selected range",
    });
    expect(sortRangeRecords(sheet, spec({ order: "sideways" as never }))).toEqual({
      ok: false,
      error: "Unknown sort order",
    });
  });
});

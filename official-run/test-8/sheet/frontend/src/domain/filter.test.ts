import { describe, expect, it } from "vitest";

import {
  CONDITION_OPTIONS,
  createFilterForSelection,
  distinctFilterValues,
  filterHeaderText,
  hiddenRowsForFilter,
  withColumnFilter,
} from "./filter";
import type { CellSelection, Worksheet, WorksheetFilter } from "./types";

function worksheet(cells: Record<string, string>): Worksheet {
  return {
    id: "sheet-1",
    name: "Sheet1",
    rowCount: 10,
    columnCount: 5,
    cells,
    selection: { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } },
    validations: [],
  };
}

const TABLE = {
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

const REGION: WorksheetFilter = {
  range: { minRow: 0, maxRow: 3, minCol: 0, maxCol: 2 },
  columns: [],
};

function selection(anchor: [number, number], focus: [number, number]): CellSelection {
  return { anchor: { row: anchor[0], col: anchor[1] }, focus: { row: focus[0], col: focus[1] } };
}

describe("filter region", () => {
  it("uses the selected rectangle as the covered region", () => {
    expect(createFilterForSelection(worksheet(TABLE), selection([0, 0], [3, 2]))).toEqual({
      range: { minRow: 0, maxRow: 3, minCol: 0, maxCol: 2 },
      columns: [],
    });
  });

  it("uses the contiguous data block when a single cell is selected", () => {
    expect(createFilterForSelection(worksheet(TABLE), selection([1, 1], [1, 1])).range).toEqual({
      minRow: 0,
      maxRow: 3,
      minCol: 0,
      maxCol: 2,
    });
    expect(createFilterForSelection(worksheet(TABLE), selection([3, 2], [3, 2])).range).toEqual({
      minRow: 0,
      maxRow: 3,
      minCol: 0,
      maxCol: 2,
    });
  });

  it("does not expand across a blank row into unrelated data", () => {
    const cells = { ...TABLE, A6: "Other" };
    expect(createFilterForSelection(worksheet(cells), selection([1, 0], [1, 0])).range).toEqual({
      minRow: 0,
      maxRow: 3,
      minCol: 0,
      maxCol: 2,
    });
  });
});

describe("filter columns", () => {
  it("lists the displayed header text and the distinct source values", () => {
    const sheet = worksheet(TABLE);
    expect(filterHeaderText(sheet, REGION, 0)).toBe("Region");
    expect(filterHeaderText(sheet, REGION, 2)).toBe("Status");
    expect(distinctFilterValues(sheet, REGION, 0)).toEqual(["East", "North", "South"]);
    expect(distinctFilterValues(sheet, REGION, 1)).toEqual(["700", "800", "1200"]);
  });

  it("falls back to the column letter for an empty header and skips blanks", () => {
    const sheet = worksheet({ B1: "", B2: "x", B3: "", B4: "y" });
    const filter: WorksheetFilter = { range: { minRow: 0, maxRow: 3, minCol: 1, maxCol: 1 }, columns: [] };
    expect(filterHeaderText(sheet, filter, 1)).toBe("B");
    expect(distinctFilterValues(sheet, filter, 1)).toEqual(["x", "y"]);
  });

  it("replaces and removes the entry of one column", () => {
    const withRegion = withColumnFilter(REGION, 0, { col: 0, kind: "values", values: ["East"] });
    expect(withRegion.columns).toEqual([{ col: 0, kind: "values", values: ["East"] }]);
    const withBoth = withColumnFilter(withRegion, 1, {
      col: 1,
      kind: "condition",
      operator: "greaterThan",
      value: "1000",
    });
    expect(withBoth.columns.map((column) => column.col)).toEqual([0, 1]);
    expect(withColumnFilter(withBoth, 0, null).columns).toEqual([
      { col: 1, kind: "condition", operator: "greaterThan", value: "1000" },
    ]);
  });

  it("offers the five named conditions", () => {
    expect(CONDITION_OPTIONS.map((option) => option.label)).toEqual([
      "Text contains",
      "Greater than",
      "Before",
      "Is empty",
      "Is not empty",
    ]);
  });
});

describe("hidden rows", () => {
  const sheet = worksheet(TABLE);

  function hidden(filter: WorksheetFilter): number[] {
    return [...hiddenRowsForFilter(sheet, filter)].sort((a, b) => a - b);
  }

  it("hides the records whose value is not selected and never the header row", () => {
    expect(hidden(withColumnFilter(REGION, 0, { col: 0, kind: "values", values: ["East"] }))).toEqual([2, 3]);
    expect(hidden(withColumnFilter(REGION, 0, { col: 0, kind: "values", values: [] }))).toEqual([1, 2, 3]);
  });

  it("matches the named conditions on the displayed value", () => {
    const contains = withColumnFilter(REGION, 0, { col: 0, kind: "condition", operator: "contains", value: "th" });
    expect(hidden(contains)).toEqual([1]);

    const greater = withColumnFilter(REGION, 1, {
      col: 1,
      kind: "condition",
      operator: "greaterThan",
      value: "800",
    });
    expect(hidden(greater)).toEqual([2, 3]);

    const before = withColumnFilter(REGION, 1, {
      col: 1,
      kind: "condition",
      operator: "before",
      value: "2024-01-02",
    });
    // Numbers parse as years for `Date.parse`, so a numeric column matches.
    expect(hidden(before)).toEqual([]);

    const empty = withColumnFilter(REGION, 0, { col: 0, kind: "condition", operator: "isEmpty", value: "" });
    expect(hidden(empty)).toEqual([1, 2, 3]);

    const notEmpty = withColumnFilter(REGION, 0, {
      col: 0,
      kind: "condition",
      operator: "isNotEmpty",
      value: "",
    });
    expect(hidden(notEmpty)).toEqual([]);
  });

  it("matches parseable dates before the given date", () => {
    const dated = worksheet({ A1: "When", A2: "2024-01-01", A3: "2024-06-01", A4: "not a date" });
    const filter: WorksheetFilter = {
      range: { minRow: 0, maxRow: 3, minCol: 0, maxCol: 0 },
      columns: [{ col: 0, kind: "condition", operator: "before", value: "2024-03-01" }],
    };
    expect([...hiddenRowsForFilter(dated, filter)]).toEqual([2, 3]);
  });

  it("combines the conditions of different columns with AND", () => {
    const filter = withColumnFilter(
      withColumnFilter(REGION, 0, { col: 0, kind: "condition", operator: "contains", value: "orth" }),
      1,
      {
        col: 1,
        kind: "condition",
        operator: "greaterThan",
        value: "1000",
      },
    );
    // North matches the region but its sales are below the limit, so AND keeps
    // only the record satisfying both conditions — here every record fails one.
    expect(hidden(filter)).toEqual([1, 2, 3]);
  });

  it("hides nothing without a filter or without a column condition", () => {
    expect([...hiddenRowsForFilter(sheet, null)]).toEqual([]);
    expect([...hiddenRowsForFilter(sheet, REGION)]).toEqual([]);
  });

  it("evaluates formulas before comparing their value", () => {
    const formulas = worksheet({ A1: "Total", A2: "=1+1", A3: "5" });
    const filter: WorksheetFilter = {
      range: { minRow: 0, maxRow: 2, minCol: 0, maxCol: 0 },
      columns: [{ col: 0, kind: "condition", operator: "greaterThan", value: "1" }],
    };
    expect([...hiddenRowsForFilter(formulas, filter)]).toEqual([]);
  });
});

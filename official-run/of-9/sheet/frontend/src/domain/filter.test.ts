import { describe, expect, it } from "vitest";

import {
  buildHiddenRows,
  columnFilterMatches,
  conditionMatches,
  distinctValues,
  formatCellRange,
} from "./filter";
import type { FilterView } from "./types";

const cells = {
  A1: { value: "Region" },
  B1: { value: "Sales" },
  C1: { value: "Status" },
  A2: { value: "East" },
  B2: { value: "1200" },
  C2: { value: "Open" },
  A3: { value: "North" },
  B3: { value: "800" },
  C3: { value: "Closed" },
  A4: { value: "South" },
  B4: { value: "700" },
  C4: { value: "Open" },
};

const range = { start: { row: 1, column: 1 }, end: { row: 6, column: 3 } };

function view(conditions: FilterView["conditions"]): FilterView {
  return { id: "f1", range, conditions };
}

describe("conditionMatches", () => {
  it("handles is-empty and is-not-empty without a value", () => {
    expect(conditionMatches("", "is-empty", "")).toBe(true);
    expect(conditionMatches("East", "is-empty", "")).toBe(false);
    expect(conditionMatches("East", "is-not-empty", "")).toBe(true);
    expect(conditionMatches("", "is-not-empty", "")).toBe(false);
  });

  it("matches text-contains case-insensitively", () => {
    expect(conditionMatches("East", "text-contains", "east")).toBe(true);
    expect(conditionMatches("East", "text-contains", "as")).toBe(true);
    expect(conditionMatches("North", "text-contains", "South")).toBe(false);
  });

  it("compares greater-than numerically when both sides are numeric", () => {
    expect(conditionMatches("1200", "greater-than", "800")).toBe(true);
    expect(conditionMatches("800", "greater-than", "800")).toBe(false);
    expect(conditionMatches("700", "greater-than", "800")).toBe(false);
  });

  it("compares before by date when both sides parse as dates", () => {
    expect(conditionMatches("2024-01-01", "before", "2024-06-01")).toBe(true);
    expect(conditionMatches("2024-12-01", "before", "2024-06-01")).toBe(false);
  });
});

describe("columnFilterMatches and buildHiddenRows", () => {
  it("hides only rows outside the selected values", () => {
    const hidden = buildHiddenRows(cells, view([{ column: 1, mode: "values", values: ["East"] }]));
    expect(hidden.has(2)).toBe(false);
    expect(hidden.has(3)).toBe(true);
    expect(hidden.has(4)).toBe(true);
  });

  it("combines conditions on different columns with AND", () => {
    const hidden = buildHiddenRows(
      cells,
      view([
        { column: 1, mode: "values", values: ["East", "North"] },
        { column: 2, mode: "condition", condition: "greater-than", value: "800" },
      ]),
    );
    expect(hidden.has(2)).toBe(false); // East + 1200 > 800
    expect(hidden.has(3)).toBe(true); // North + 800 not > 800
    expect(hidden.has(4)).toBe(true); // outside the selected Region values
  });

  it("keeps the header row and rows outside the filter range visible", () => {
    const hidden = buildHiddenRows(
      cells,
      view([{ column: 1, mode: "condition", condition: "text-contains", value: "xyz" }]),
    );
    expect(hidden.has(1)).toBe(false);
    expect(hidden.has(7)).toBe(false); // outside the range is never evaluated
    expect(hidden.has(8)).toBe(false);
    expect(hidden.has(2)).toBe(true);
    expect(hidden.has(5)).toBe(true); // empty rows inside the range still fail the condition
  });

  it("returns no hidden rows when there are no conditions", () => {
    expect(buildHiddenRows(cells, view([])).size).toBe(0);
  });
});

describe("distinctValues and formatCellRange", () => {
  it("lists distinct non-header values in order of first appearance", () => {
    expect(distinctValues(cells, range, 1)).toEqual(["East", "North", "South", ""]);
    expect(distinctValues(cells, range, 2)).toEqual(["1200", "800", "700", ""]);
    expect(distinctValues(cells, range, 3)).toEqual(["Open", "Closed", ""]);
  });

  it("formats a range as A1:C6", () => {
    expect(formatCellRange(range)).toBe("A1:C6");
  });

  it("columnFilterMatches selects exact source values", () => {
    expect(columnFilterMatches("East", { column: 1, mode: "values", values: ["East", "North"] })).toBe(true);
    expect(columnFilterMatches("South", { column: 1, mode: "values", values: ["East", "North"] })).toBe(false);
  });
});

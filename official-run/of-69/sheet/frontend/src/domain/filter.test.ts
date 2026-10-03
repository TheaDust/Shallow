import { describe, expect, it } from "vitest";

import {
  distinctColumnValues,
  filterColumns,
  filterRegionFor,
  hiddenRowSet,
  rowMatchesRule,
} from "./filter";
import type { FilterRule, Worksheet } from "./types";

const sheet: Worksheet = {
  id: "ws-1",
  name: "Sheet1",
  rowCount: 30,
  columnCount: 26,
  cells: {
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
  },
  selection: { anchor: "A1", focus: "A1" },
};

const REGION = "A1:C4";

function withFilter(rules: FilterRule[]): Worksheet {
  return { ...sheet, filter: { range: REGION, rules } };
}

describe("filter views", () => {
  it("hides only the data rows that break a value rule", () => {
    const worksheet = withFilter([{ column: 0, mode: "values", values: ["East", "South"] }]);
    expect([...hiddenRowSet(worksheet)]).toEqual([2]);
    expect(hiddenRowSet(sheet).size).toBe(0);
    expect(hiddenRowSet(withFilter([])).size).toBe(0);
  });

  it("matches text, number, date and emptiness conditions", () => {
    expect(rowMatchesRule(sheet, 1, { column: 0, mode: "condition", condition: "text-contains", value: "ea" })).toBe(true);
    expect(rowMatchesRule(sheet, 2, { column: 1, mode: "condition", condition: "greater-than", value: "750" })).toBe(true);
    expect(rowMatchesRule(sheet, 3, { column: 1, mode: "condition", condition: "greater-than", value: "750" })).toBe(false);
    expect(rowMatchesRule(sheet, 1, { column: 2, mode: "condition", condition: "is-empty", value: "" })).toBe(false);
    expect(rowMatchesRule(sheet, 5, { column: 2, mode: "condition", condition: "is-empty", value: "" })).toBe(true);
    expect(rowMatchesRule(sheet, 2, { column: 2, mode: "condition", condition: "is-not-empty", value: "" })).toBe(true);
    expect(rowMatchesRule(sheet, 2, { column: 2, mode: "condition", condition: "before", value: "2026-01-01" })).toBe(false);

    const dated: Worksheet = { ...sheet, cells: { ...sheet.cells, C2: { value: "2025-01-05" } } };
    expect(rowMatchesRule(dated, 1, { column: 2, mode: "condition", condition: "before", value: "2026-01-01" })).toBe(true);
    expect(rowMatchesRule(dated, 2, { column: 2, mode: "condition", condition: "before", value: "2026-01-01" })).toBe(false);
  });

  it("combines conditions on different columns with AND", () => {
    const worksheet = withFilter([
      { column: 1, mode: "condition", condition: "greater-than", value: "750" },
      { column: 2, mode: "condition", condition: "is-not-empty", value: "" },
    ]);
    expect([...hiddenRowSet(worksheet)]).toEqual([3]);
  });

  it("lists the distinct source values and the filtered header columns", () => {
    const worksheet = withFilter([]);
    expect(distinctColumnValues(worksheet, worksheet.filter!, 0)).toEqual(["East", "North", "South"]);
    expect(distinctColumnValues(worksheet, worksheet.filter!, 1)).toEqual(["1200", "800", "700"]);
    expect(filterColumns(worksheet)).toEqual([
      { column: 0, header: "Region" },
      { column: 1, header: "Sales" },
      { column: 2, header: "Status" },
    ]);
    expect(filterColumns(sheet)).toEqual([]);
  });

  it("uses the selected rectangle, or the contiguous block around a single cell", () => {
    expect(filterRegionFor(sheet, { anchor: "B2", focus: "C3" })).toBe("B2:C3");
    expect(filterRegionFor(sheet, { anchor: "B2", focus: "B2" })).toBe("A1:C4");
    expect(filterRegionFor(sheet, { anchor: "A1", focus: "A1" })).toBe("A1:C4");
    expect(filterRegionFor(sheet, { anchor: "H9", focus: "H9" })).toBe("H9:H9");
  });

  it("hides nothing outside the filtered region", () => {
    const worksheet = withFilter([{ column: 0, mode: "values", values: ["East"] }]);
    const hidden = hiddenRowSet(worksheet);
    expect(hidden.has(0)).toBe(false);
    expect(hidden.has(1)).toBe(false);
    expect(hidden.has(5)).toBe(false);
  });
});

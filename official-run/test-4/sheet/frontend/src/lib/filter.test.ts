import { describe, expect, it } from "vitest";

import {
  distinctValues,
  matchesColumnFilter,
  parseDate,
  rowMatchesFilter,
  type ColumnFilter,
  type SheetFilter,
} from "./filter";

const seeded = {
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

describe("distinctValues", () => {
  it("collects distinct non-empty column values below the header row in first-appearance order", () => {
    const values = distinctValues(seeded, {}, { start: "A1", end: "C6" }, "A");
    expect(values).toEqual(["East", "North", "South"]);
    expect(distinctValues(seeded, {}, { start: "A1", end: "C6" }, "C")).toEqual([
      "Open",
      "Closed",
    ]);
  });

  it("skips empty cells and does not include the header text", () => {
    const cells = { A1: "Header", A2: "x", A4: "x" };
    const values = distinctValues(cells, {}, { start: "A1", end: "A6" }, "A");
    expect(values).toEqual(["x"]);
  });
});

describe("parseDate", () => {
  it("parses ISO, slashed, and dotted date texts", () => {
    expect(parseDate("2026-03-15")).toBe(Date.UTC(2026, 2, 15));
    expect(parseDate("2026/3/15")).toBe(Date.UTC(2026, 2, 15));
    expect(parseDate("3/15/2026")).toBe(Date.UTC(2026, 2, 15));
    expect(parseDate("not a date")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("matchesColumnFilter", () => {
  it("keeps rows whose value is among the selected values", () => {
    const filter: ColumnFilter = { kind: "values", selected: ["East", "North"] };
    expect(matchesColumnFilter("East", filter)).toBe(true);
    expect(matchesColumnFilter("South", filter)).toBe(false);
  });

  it("Text contains matches case-insensitively", () => {
    const filter: ColumnFilter = { kind: "condition", condition: "Text contains", value: "orth" };
    expect(matchesColumnFilter("North", filter)).toBe(true);
    expect(matchesColumnFilter("NORTH", filter)).toBe(true);
    expect(matchesColumnFilter("East", filter)).toBe(false);
  });

  it("Greater than compares numeric values and ignores non-numeric cells", () => {
    const filter: ColumnFilter = { kind: "condition", condition: "Greater than", value: "900" };
    expect(matchesColumnFilter("1200", filter)).toBe(true);
    expect(matchesColumnFilter("800", filter)).toBe(false);
    expect(matchesColumnFilter("Open", filter)).toBe(false);
    expect(matchesColumnFilter("", filter)).toBe(false);
  });

  it("Before compares parsed dates", () => {
    const filter: ColumnFilter = { kind: "condition", condition: "Before", value: "2026-02-01" };
    expect(matchesColumnFilter("2026-01-15", filter)).toBe(true);
    expect(matchesColumnFilter("2026-03-01", filter)).toBe(false);
    expect(matchesColumnFilter("not a date", filter)).toBe(false);
  });

  it("Is empty and Is not empty test the raw cell text", () => {
    const empty: ColumnFilter = { kind: "condition", condition: "Is empty", value: "" };
    const notEmpty: ColumnFilter = { kind: "condition", condition: "Is not empty", value: "" };
    expect(matchesColumnFilter("", empty)).toBe(true);
    expect(matchesColumnFilter("x", empty)).toBe(false);
    expect(matchesColumnFilter("", notEmpty)).toBe(false);
    expect(matchesColumnFilter("x", notEmpty)).toBe(true);
  });
});

describe("rowMatchesFilter", () => {
  const filter: SheetFilter = {
    start: "A1",
    end: "C6",
    columns: {
      A: { kind: "values", selected: ["East"] },
      B: { kind: "condition", condition: "Greater than", value: "900" },
    },
  };

  it("combines conditions on different columns with AND", () => {
    // row 2: East / 1200 matches both
    expect(rowMatchesFilter(seeded, {}, filter, 2)).toBe(true);
    // row 3: North / 800 fails the B condition
    expect(rowMatchesFilter(seeded, {}, filter, 3)).toBe(false);
    // row 4: South / 700 fails both
    expect(rowMatchesFilter(seeded, {}, filter, 4)).toBe(false);
  });

  it("never hides the header row or rows outside the filter rectangle", () => {
    expect(rowMatchesFilter(seeded, {}, filter, 1)).toBe(true);
    expect(rowMatchesFilter(seeded, {}, filter, 50)).toBe(true);
    // row 6 is inside the rectangle, so the empty row is hidden by the value filter
    expect(rowMatchesFilter(seeded, {}, filter, 6)).toBe(false);
  });

  it("returns true when no filter is active", () => {
    expect(rowMatchesFilter(seeded, {}, null, 3)).toBe(true);
  });

  it("uses displayed formula results when filtering", () => {
    const cells = { ...seeded, B2: "=A1", B3: "=1000+200" };
    const results = { B2: "Region", B3: "1200" };
    const salesOnly: SheetFilter = {
      start: "A1",
      end: "C6",
      columns: { B: { kind: "condition", condition: "Greater than", value: "900" } },
    };
    // B3 displays 1200, which passes "Greater than 900" even though B2's text does not
    expect(rowMatchesFilter(cells, results, salesOnly, 3)).toBe(true);
    expect(rowMatchesFilter(cells, results, salesOnly, 2)).toBe(false);
  });
});

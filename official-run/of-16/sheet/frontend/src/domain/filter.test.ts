import { describe, expect, it } from "vitest";

import { seedWorkbook } from "../test/fake-backend";
import {
  distinctColumnValues,
  filterHeaderColumns,
  filterRegionFor,
  hiddenRows,
  matchesFilterRule,
  parseRangeText,
  rangeText,
  usedRegion,
  withFilterRule,
} from "./filter";
import type { Worksheet, WorksheetFilter } from "./workbook";

const sheet = (): Worksheet => seedWorkbook().worksheets[0];

const selection = (anchor: [number, number], focus: [number, number] = anchor) => ({
  anchor: { row: anchor[0], col: anchor[1] },
  focus: { row: focus[0], col: focus[1] },
});

const filter = (range: string, rules: WorksheetFilter["rules"] = []): WorksheetFilter => ({ range, rules });

describe("filter regions", () => {
  it("round-trips an A1 rectangle and rejects malformed text", () => {
    expect(parseRangeText("a1:c4")).toEqual({ minRow: 0, maxRow: 3, minCol: 0, maxCol: 2 });
    expect(rangeText({ minRow: 0, maxRow: 3, minCol: 0, maxCol: 2 })).toBe("A1:C4");
    expect(rangeText({ minRow: 1, maxRow: 1, minCol: 1, maxCol: 1 })).toBe("B2");
    expect(parseRangeText("A1:B2:C3")).toBeNull();
    expect(parseRangeText("nope")).toBeNull();
  });

  it("expands a single selected cell to the used data region and honors a rectangle", () => {
    expect(usedRegion(sheet())).toEqual({ minRow: 0, maxRow: 3, minCol: 0, maxCol: 2 });
    expect(filterRegionFor(sheet(), selection([2, 1]))).toEqual({ minRow: 0, maxRow: 3, minCol: 0, maxCol: 2 });
    // A selected rectangle is used as it is: filtering never expands to adjacent data.
    expect(filterRegionFor(sheet(), selection([0, 0], [2, 1]))).toEqual({
      minRow: 0,
      maxRow: 2,
      minCol: 0,
      maxCol: 1,
    });
  });

  it("lists the headers of the region and the distinct values of a column", () => {
    const worksheet = sheet();
    expect(filterHeaderColumns(worksheet, filter("A1:C4")).map((entry) => entry.header)).toEqual([
      "Region",
      "Sales",
      "Status",
    ]);
    const region = parseRangeText("A1:C4")!;
    expect(distinctColumnValues(worksheet, region, 0)).toEqual(["East", "North", "South"]);
    expect(distinctColumnValues(worksheet, region, 2)).toEqual(["Open", "Closed"]);
  });
});

describe("filter rules", () => {
  it("matches values, text, numbers, emptiness and dates", () => {
    expect(matchesFilterRule("East", { header: "Region", type: "values", values: ["East"] })).toBe(true);
    expect(matchesFilterRule("North", { header: "Region", type: "values", values: ["East"] })).toBe(false);
    expect(matchesFilterRule("North", { header: "Region", type: "condition", condition: "text-contains", value: "nor" })).toBe(true);
    expect(matchesFilterRule("East", { header: "Region", type: "condition", condition: "text-contains", value: "nor" })).toBe(false);
    expect(matchesFilterRule("1200", { header: "Sales", type: "condition", condition: "greater-than", value: "1000" })).toBe(true);
    expect(matchesFilterRule("800", { header: "Sales", type: "condition", condition: "greater-than", value: "1000" })).toBe(false);
    expect(matchesFilterRule("East", { header: "Sales", type: "condition", condition: "greater-than", value: "1000" })).toBe(false);
    expect(matchesFilterRule("2026-08-01", { header: "Date", type: "condition", condition: "before", value: "2026-09-01" })).toBe(true);
    expect(matchesFilterRule("2026-10-01", { header: "Date", type: "condition", condition: "before", value: "2026-09-01" })).toBe(false);
    expect(matchesFilterRule("", { header: "Region", type: "condition", condition: "is-empty" })).toBe(true);
    expect(matchesFilterRule("  ", { header: "Region", type: "condition", condition: "is-not-empty" })).toBe(false);
    expect(matchesFilterRule("East", { header: "Region", type: "condition", condition: "is-not-empty" })).toBe(true);
  });

  it("hides only the nonmatching data rows of the filtered region", () => {
    const worksheet = sheet();
    const eastOnly = filter("A1:C4", [{ header: "Region", type: "values", values: ["East"] }]);
    expect([...hiddenRows(worksheet, eastOnly)].sort()).toEqual([2, 3]);
    expect([...hiddenRows(worksheet, filter("A1:C4"))]).toEqual([]);
    expect([...hiddenRows(worksheet, undefined)]).toEqual([]);
    // Rows outside the region are never hidden by its rules.
    const headerOnly = filter("A1:C1", [{ header: "Region", type: "values", values: [] }]);
    expect([...hiddenRows(worksheet, headerOnly)]).toEqual([]);
  });

  it("combines conditions of different columns with AND", () => {
    const worksheet = sheet();
    const combined = filter("A1:C4", [
      { header: "Region", type: "condition", condition: "text-contains", value: "o" },
      { header: "Sales", type: "condition", condition: "greater-than", value: "750" },
    ]);
    // East has no "o"; South is below 750; only North satisfies both.
    expect([...hiddenRows(worksheet, combined)].sort()).toEqual([1, 3]);
  });

  it("ignores a rule whose header no longer exists and replaces a column rule", () => {
    const worksheet = sheet();
    const renamed = filter("A1:C4", [{ header: "Territory", type: "values", values: [] }]);
    expect([...hiddenRows(worksheet, renamed)]).toEqual([]);

    const replaced = withFilterRule(filter("A1:C4", [{ header: "Region", type: "values", values: ["East"] }]), null, "Region");
    expect(replaced.rules).toEqual([]);
    const added = withFilterRule(replaced, { header: "Status", type: "values", values: ["Open"] }, "Status");
    expect(added.rules).toEqual([{ header: "Status", type: "values", values: ["Open"] }]);
    expect(added.range).toBe("A1:C4");
  });
});

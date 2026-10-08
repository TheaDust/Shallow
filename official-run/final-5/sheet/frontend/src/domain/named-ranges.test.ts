import { describe, expect, test } from "vitest";

import { computeDisplayValues } from "./formula";
import { buildNamedRangeMap, parseNamedRangeReference, namedRangeStartsWithLetter } from "./named-ranges";

describe("named ranges", () => {
  test("parses an optional sheet and canonicalises the A1 area", () => {
    expect(parseNamedRangeReference("ForecastModel!j5:j3")).toEqual({
      sheet: "ForecastModel",
      start: "J3",
      end: "J5",
    });
    expect(parseNamedRangeReference("K2")).toEqual({ sheet: null, start: "K2", end: "K2" });
    expect(parseNamedRangeReference("nope")).toBeNull();
    expect(parseNamedRangeReference("!A1")).toBeNull();
  });

  test("a formula resolves a saved name to the range's cells", () => {
    const cells = { J3: "18", J4: "24", J5: "31", L3: "=SUM(CapacityPlan)", M2: "12" };
    const names = buildNamedRangeMap(
      [
        { name: "CapacityPlan", range: "ForecastModel!J3:J5" },
        { name: "Bonus", range: "M2" },
      ],
      "ForecastModel",
    );
    const values = computeDisplayValues(cells, names);
    expect(values.L3).toBe("73");
    expect(computeDisplayValues({ A1: "=SUM(Bonus)", M2: "12" }, names).A1).toBe("12");
    expect(computeDisplayValues({ A1: "=SUM(Bonus)", M2: "12" })).toEqual({ A1: "#NAME?", M2: "12" });
  });

  test("a name is only resolvable on the sheet its reference points at", () => {
    const entries = [{ name: "Plan", range: "Budget!A1:A2" }];
    expect(buildNamedRangeMap(entries, "Budget")).toEqual({ PLAN: { start: "A1", end: "A2" } });
    expect(buildNamedRangeMap(entries, "ForecastModel")).toEqual({});
  });

  test("the name rule only accepts a leading letter", () => {
    expect(namedRangeStartsWithLetter("CapacityPlan")).toBe(true);
    expect(namedRangeStartsWithLetter("  MarginBase ")).toBe(true);
    expect(namedRangeStartsWithLetter("1stBatch")).toBe(false);
    expect(namedRangeStartsWithLetter("")).toBe(false);
  });
});

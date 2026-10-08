import { describe, expect, test } from "vitest";

import { conditionalFillFor, formatConditionMatches } from "./formatting";

describe("conditional formatting fills", () => {
  test("Greater than only matches parseable numeric values above the threshold", () => {
    const rule = { range: "J4:J6", condition: "Greater than", value: "25", style: "Red fill" };
    expect(formatConditionMatches(rule, "29")).toBe(true);
    expect(formatConditionMatches(rule, "25")).toBe(false);
    expect(formatConditionMatches(rule, "11")).toBe(false);
    expect(formatConditionMatches(rule, "Watch")).toBe(false);
    expect(formatConditionMatches(rule, "")).toBe(false);
  });

  test("Text contains matches a substring and ignores the rest", () => {
    const rule = { range: "K4:K6", condition: "Text contains", value: "Watch", style: "Yellow fill" };
    expect(formatConditionMatches(rule, "Watch")).toBe(true);
    expect(formatConditionMatches(rule, "Stable")).toBe(false);
  });

  test("a fill only paints matching cells inside the rule's range", () => {
    const rules = [{ range: "J4:J6", condition: "Greater than", value: "25", style: "Red fill" }];
    expect(conditionalFillFor(rules, "J5", "29")).toBe("rgb(254, 226, 226)");
    expect(conditionalFillFor(rules, "J4", "11")).toBeNull();
    expect(conditionalFillFor(rules, "K5", "29")).toBeNull();
    expect(conditionalFillFor(undefined, "J5", "29")).toBeNull();
  });
});

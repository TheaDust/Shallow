import { describe, expect, test } from "vitest";

import { conditionalFills, fillColor, formatRuleMatches } from "./formatting";
import type { FormatRule } from "./types";

const numericRule: FormatRule = { range: "J4:J6", condition: "greater-than", value: "25", style: "red" };
const textRule: FormatRule = { range: "K4:K6", condition: "text-contains", value: "Watch", style: "yellow" };

describe("formatRuleMatches", () => {
  test("Greater than compares parsed numbers and never matches text or blanks", () => {
    expect(formatRuleMatches(numericRule, "29")).toBe(true);
    expect(formatRuleMatches(numericRule, "25")).toBe(false);
    expect(formatRuleMatches(numericRule, "11")).toBe(false);
    expect(formatRuleMatches(numericRule, "Watch")).toBe(false);
    expect(formatRuleMatches(numericRule, undefined)).toBe(false);
    // A threshold that is not a number matches nothing.
    expect(formatRuleMatches({ ...numericRule, value: "abc" }, "29")).toBe(false);
  });

  test("Text contains looks inside the value and ignores letter case", () => {
    expect(formatRuleMatches(textRule, "Watch")).toBe(true);
    expect(formatRuleMatches(textRule, "Watchlist")).toBe(true);
    expect(formatRuleMatches(textRule, "watch")).toBe(true);
    expect(formatRuleMatches(textRule, "Stable")).toBe(false);
    expect(formatRuleMatches({ ...textRule, value: "" }, "Watch")).toBe(false);
  });
});

describe("conditionalFills", () => {
  test("colours only the cells of the range that satisfy the condition", () => {
    const values = { J4: "11", J5: "29", J6: "46", K1: "29" };
    expect(conditionalFills([numericRule], values)).toEqual({ J5: "#fee2e2", J6: "#fee2e2" });
  });

  test("uses the exact background of each style and lets the last rule win", () => {
    expect(fillColor("red")).toBe("#fee2e2");
    expect(fillColor("yellow")).toBe("#fef9c3");
    expect(fillColor("green")).toBe("#dcfce7");
    const values = { J5: "29" };
    const fills = conditionalFills([numericRule, { ...numericRule, range: "J5", style: "green" }], values);
    expect(fills.J5).toBe("#dcfce7");
  });

  test("ignores a rule without a usable range", () => {
    expect(conditionalFills([{ ...numericRule, range: "nope" }], { J5: "29" })).toEqual({});
    expect(conditionalFills(undefined, { J5: "29" })).toEqual({});
  });
});

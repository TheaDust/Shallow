import { describe, expect, test } from "vitest";

import { FILL_COLORS, conditionalFill, parseRuleNumber, ruleMatches } from "./conditional";
import type { ConditionalFormatRule } from "./types";

function rule(overrides: Partial<ConditionalFormatRule> = {}): ConditionalFormatRule {
  return { id: "cf-1", range: "J4:J6", condition: "Greater than", value: "25", style: "Red fill", ...overrides };
}

describe("conditional formatting rules", () => {
  test("Greater than applies to parseable numeric values only", () => {
    const numeric = rule();
    expect(ruleMatches(numeric, "29")).toBe(true);
    expect(ruleMatches(numeric, "25")).toBe(false);
    expect(ruleMatches(numeric, "Stable")).toBe(false);
    expect(ruleMatches(numeric, "")).toBe(false);
    expect(ruleMatches(rule({ value: "abc" }), "29")).toBe(false);
    expect(parseRuleNumber(" 46 ")).toBe(46);
  });

  test("Text contains applies to text values, ignoring letter case", () => {
    const text = rule({ condition: "Text contains", value: "Watch" });
    expect(ruleMatches(text, "Watch")).toBe(true);
    expect(ruleMatches(text, "on watch duty")).toBe(true);
    expect(ruleMatches(text, "Stable")).toBe(false);
  });

  test("only matching cells inside the rule's range show the fill", () => {
    const rules = [rule(), rule({ id: "cf-2", range: "K4:K6", condition: "Text contains", value: "Watch", style: "Yellow fill" })];
    expect(conditionalFill(rules, 5, 10, "29")).toBe(FILL_COLORS["Red fill"]);
    expect(conditionalFill(rules, 4, 10, "11")).toBeNull();
    expect(conditionalFill(rules, 4, 11, "Watch")).toBe(FILL_COLORS["Yellow fill"]);
    expect(conditionalFill(rules, 7, 10, "46")).toBeNull();
    expect(conditionalFill(undefined, 5, 10, "29")).toBeNull();
  });

  test("the first matching rule wins, so an edited earlier rule keeps painting", () => {
    const rules = [rule({ style: "Green fill" }), rule({ id: "cf-2", style: "Red fill" })];
    expect(conditionalFill(rules, 5, 10, "29")).toBe(FILL_COLORS["Green fill"]);
  });
});

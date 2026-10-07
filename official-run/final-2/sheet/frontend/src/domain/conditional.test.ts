import { describe, expect, test } from "vitest";

import {
  CONDITION_OPTIONS,
  FILL_COLORS,
  STYLE_OPTIONS,
  conditionalEntries,
  conditionalFills,
  matchesConditionalRule,
} from "./conditional";
import type { ConditionalRule } from "./types";

const numericRule: ConditionalRule = {
  range: "J4:J6",
  condition: "greater-than",
  value: "25",
  style: "red-fill",
};

const textRule: ConditionalRule = {
  range: "K4:K6",
  condition: "text-contains",
  value: "Watch",
  style: "yellow-fill",
};

describe("the dialog's condition and style options", () => {
  test("offer the required names in order", () => {
    expect(CONDITION_OPTIONS.map((option) => option.label)).toEqual(["Greater than", "Text contains"]);
    expect(STYLE_OPTIONS.map((option) => option.label)).toEqual(["Red fill", "Yellow fill", "Green fill"]);
    expect(FILL_COLORS["red-fill"]).toBe("rgb(254, 226, 226)");
    expect(FILL_COLORS["yellow-fill"]).toBe("rgb(254, 249, 195)");
    expect(FILL_COLORS["green-fill"]).toBe("rgb(220, 252, 231)");
  });
});

describe("matchesConditionalRule", () => {
  test("Greater than keeps only parseable numbers above the threshold", () => {
    expect(matchesConditionalRule(numericRule, "29")).toBe(true);
    expect(matchesConditionalRule(numericRule, "25")).toBe(false);
    expect(matchesConditionalRule(numericRule, "11")).toBe(false);
    expect(matchesConditionalRule(numericRule, "Watch")).toBe(false);
    expect(matchesConditionalRule(numericRule, "")).toBe(false);
  });

  test("Text contains keeps the values holding the text, ignoring letter case", () => {
    expect(matchesConditionalRule(textRule, "Watch")).toBe(true);
    expect(matchesConditionalRule(textRule, "night watch")).toBe(true);
    expect(matchesConditionalRule(textRule, "Elevated")).toBe(false);
  });
});

describe("conditionalFills", () => {
  test("paints only the matching cells of a rule's own range", () => {
    const values = { J4: "11", J5: "29", J6: "46", J7: "99" };
    expect(conditionalFills([numericRule], values)).toEqual({
      J5: "rgb(254, 226, 226)",
      J6: "rgb(254, 226, 226)",
    });
  });

  test("an empty or absent rule list paints nothing", () => {
    expect(conditionalEntries(undefined)).toEqual([]);
    expect(conditionalFills(undefined, { J5: "29" })).toEqual({});
  });

  test("a cell covered by two rules keeps the first rule's fill", () => {
    const second: ConditionalRule = { range: "J5:J6", condition: "greater-than", value: "25", style: "green-fill" };
    expect(conditionalFills([numericRule, second], { J5: "29", J6: "46" })).toEqual({
      J5: "rgb(254, 226, 226)",
      J6: "rgb(254, 226, 226)",
    });
  });

  test("a single-cell range and a text rule paint their own cell only", () => {
    const single: ConditionalRule = { range: "L4", condition: "text-contains", value: "Wa", style: "green-fill" };
    expect(conditionalFills([textRule, single], { K4: "Watch", K5: "Stable", L4: "Warden" })).toEqual({
      K4: "rgb(254, 249, 195)",
      L4: "rgb(220, 252, 231)",
    });
  });
});

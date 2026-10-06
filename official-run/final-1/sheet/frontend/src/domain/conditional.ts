/**
 * Conditional formatting as the grid renders it: a rule watches an A1 range and
 * paints every matching cell with one visible fill style. "Greater than" applies
 * to parseable numeric values, "Text contains" to text values; a cell that does
 * not match keeps its plain background.
 *
 * The style names and their colors are the only mapping between what the dialog
 * stores and what the grid shows.
 */

import { regionFromArea, type CellRegion } from "./grid";
import type { ConditionalFormatCondition, ConditionalFormatRule, ConditionalFormatStyle } from "./types";

/** Condition options offered by the "Condition" field, in dialog order. */
export const CONDITION_OPTIONS: readonly ConditionalFormatCondition[] = ["Greater than", "Text contains"];
/** Style options offered by the "Style" field, in dialog order. */
export const STYLE_OPTIONS: readonly ConditionalFormatStyle[] = ["Red fill", "Yellow fill", "Green fill"];

/** Visible fill of every style option. */
export const FILL_COLORS: Record<ConditionalFormatStyle, string> = {
  "Red fill": "rgb(254, 226, 226)",
  "Yellow fill": "rgb(254, 249, 195)",
  "Green fill": "rgb(220, 252, 231)",
};

/** Shown when the "Value" field is submitted empty. */
export const MISSING_VALUE_MESSAGE = "Value is required";
/** Shown when the submitted range is not an A1 area. */
export const INVALID_RULE_RANGE_MESSAGE = "Enter a valid cell range";

/** Numeric value of a cell's displayed text, or `null` when it is not numeric. */
export function parseRuleNumber(text: string): number | null {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** True when one cell's displayed text fulfils the rule's condition. */
export function ruleMatches(rule: ConditionalFormatRule, displayed: string | undefined): boolean {
  const text = String(displayed ?? "");
  if (rule.condition === "Text contains") {
    const wanted = rule.value.trim();
    return wanted !== "" && text.toLowerCase().includes(wanted.toLowerCase());
  }
  const target = parseRuleNumber(rule.value);
  if (target === null) return false;
  const value = parseRuleNumber(text);
  return value !== null && value > target;
}

function ruleRegion(rule: ConditionalFormatRule): CellRegion | null {
  return regionFromArea(rule.range);
}

/**
 * Fill color one cell shows, or `null` when no rule matches it. The rules are
 * applied in stored order and the first matching rule wins, so the earlier rule
 * keeps painting the cell it already matched.
 */
export function conditionalFill(
  rules: readonly ConditionalFormatRule[] | undefined,
  row: number,
  column: number,
  displayed: string | undefined,
): string | null {
  for (const rule of rules ?? []) {
    const region = ruleRegion(rule);
    if (!region) continue;
    if (row < region.top || row > region.bottom || column < region.left || column > region.right) continue;
    if (!ruleMatches(rule, displayed)) continue;
    const color = FILL_COLORS[rule.style];
    if (color) return color;
  }
  return null;
}

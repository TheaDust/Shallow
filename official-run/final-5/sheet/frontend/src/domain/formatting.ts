/**
 * Client-side helpers for a worksheet's conditional-formatting rules.
 *
 * A rule covers an A1 area and paints a visible fill on the cells inside it
 * whose displayed value matches its condition. `Greater than` only applies to
 * parseable numeric values while `Text contains` applies to text, so a rule
 * never colours a cell it does not match. The dialog offers exactly the
 * condition and style names defined here; the server validates them on save.
 */

import { isInsideRegion, parseCellName, regionFromArea } from "./grid";
import type { ConditionalFormatRule } from "./types";

export const CONDITION_GREATER_THAN = "Greater than";
export const CONDITION_TEXT_CONTAINS = "Text contains";

export const CONDITION_OPTIONS = [
  { value: CONDITION_GREATER_THAN, label: CONDITION_GREATER_THAN },
  { value: CONDITION_TEXT_CONTAINS, label: CONDITION_TEXT_CONTAINS },
];

export const STYLE_RED = "Red fill";
export const STYLE_YELLOW = "Yellow fill";
export const STYLE_GREEN = "Green fill";

export const STYLE_OPTIONS = [
  { value: STYLE_RED, label: STYLE_RED },
  { value: STYLE_YELLOW, label: STYLE_YELLOW },
  { value: STYLE_GREEN, label: STYLE_GREEN },
];

/** Visible background each style paints; checked as the cell's computed color. */
export const FILL_COLORS: Record<string, string> = {
  [STYLE_RED]: "rgb(254, 226, 226)",
  [STYLE_YELLOW]: "rgb(254, 249, 195)",
  [STYLE_GREEN]: "rgb(220, 252, 231)",
};

export const VALUE_REQUIRED_MESSAGE = "Please enter a value";
export const VALUE_NOT_NUMBER_MESSAGE = "Please enter a number";

/**
 * True when `displayValue` satisfies one rule. `Greater than` parses the cell's
 * displayed value as a number and compares it; a non-numeric cell never
 * matches. `Text contains` is a case-sensitive substring test.
 */
export function formatConditionMatches(rule: ConditionalFormatRule, displayValue: string): boolean {
  const text = String(displayValue ?? "");
  if (rule.condition === CONDITION_GREATER_THAN) {
    const left = Number(text.trim());
    const right = Number(String(rule.value ?? "").trim());
    if (text.trim() === "" || !Number.isFinite(left) || !Number.isFinite(right)) return false;
    return left > right;
  }
  if (rule.condition === CONDITION_TEXT_CONTAINS) {
    return text.includes(String(rule.value ?? ""));
  }
  return false;
}

/**
 * Visible background `coordinate` shows for the worksheet's rules, or `null`
 * when no rule matches it. Rules are applied in order, so the last matching
 * rule's style wins (matching how a later rule paints over an earlier one).
 */
export function conditionalFillFor(
  rules: ConditionalFormatRule[] | undefined,
  coordinate: string,
  displayValue: string,
): string | null {
  if (!Array.isArray(rules) || rules.length === 0) return null;
  const position = parseCellName(coordinate);
  if (!position) return null;
  let fill: string | null = null;
  for (const rule of rules) {
    const bounds = regionFromArea(rule?.range ?? "");
    if (!bounds) continue;
    if (!isInsideRegion(position.row, position.column, bounds)) continue;
    if (!formatConditionMatches(rule, displayValue)) continue;
    fill = FILL_COLORS[rule.style] ?? null;
  }
  return fill;
}

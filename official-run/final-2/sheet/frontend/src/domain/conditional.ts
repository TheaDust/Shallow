/**
 * Client-side helpers for a worksheet's conditional formatting rules.
 *
 * A rule paints the cells of its A1 range whose value satisfies the condition:
 * `Greater than` matches parseable numbers above the stored threshold,
 * `Text contains` matches text holding the stored text. The rules are
 * display-only (the server stores them, cells and formulas stay untouched) and
 * are evaluated in stored order, so the first rule covering a cell decides the
 * fill it shows.
 */

import { cellName, regionFromArea } from "./grid";
import {
  GREATER_THAN_CONDITION,
  TEXT_CONTAINS_CONDITION,
  type ConditionalRule,
} from "./types";

export const INVALID_CONDITIONAL_MESSAGE = "Invalid conditional formatting rule";

export const RED_FILL_STYLE = "red-fill";
export const YELLOW_FILL_STYLE = "yellow-fill";
export const GREEN_FILL_STYLE = "green-fill";

/** Options of the dialog's "Condition" combo box, in display order. */
export const CONDITION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: GREATER_THAN_CONDITION, label: "Greater than" },
  { value: TEXT_CONTAINS_CONDITION, label: "Text contains" },
];

/** Options of the dialog's "Style" combo box, in display order. */
export const STYLE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: RED_FILL_STYLE, label: "Red fill" },
  { value: YELLOW_FILL_STYLE, label: "Yellow fill" },
  { value: GREEN_FILL_STYLE, label: "Green fill" },
];

/** Visible fill color of each style, as the grid paints it. */
export const FILL_COLORS: Record<string, string> = {
  [RED_FILL_STYLE]: "rgb(254, 226, 226)",
  [YELLOW_FILL_STYLE]: "rgb(254, 249, 195)",
  [GREEN_FILL_STYLE]: "rgb(220, 252, 231)",
};

/** Conditional formatting rules of a worksheet, in stored order. */
export function conditionalEntries(rules: ConditionalRule[] | undefined): ConditionalRule[] {
  return Array.isArray(rules) ? rules : [];
}

/** True when one displayed cell value satisfies one rule's condition. */
export function matchesConditionalRule(rule: ConditionalRule, value: string): boolean {
  if (rule.condition === GREATER_THAN_CONDITION) {
    const actual = value.trim() === "" ? Number.NaN : Number(value.trim());
    const limit = rule.value.trim() === "" ? Number.NaN : Number(rule.value.trim());
    return Number.isFinite(actual) && Number.isFinite(limit) && actual > limit;
  }
  if (rule.condition === TEXT_CONTAINS_CONDITION) {
    const needle = rule.value.trim();
    return needle !== "" && value.toLowerCase().includes(needle.toLowerCase());
  }
  return false;
}

/**
 * Fill color of every cell a rule matches, keyed by coordinate. Rules are read
 * in stored order and a cell keeps the first matching rule's fill, so a cell
 * covered by two rules shows one stable style.
 */
export function conditionalFills(
  rules: ConditionalRule[] | undefined,
  values: Record<string, string>,
): Record<string, string> {
  const fills: Record<string, string> = {};
  for (const rule of conditionalEntries(rules)) {
    const region = regionFromArea(rule.range);
    const color = FILL_COLORS[rule.style];
    if (!region || !color) continue;
    for (let row = region.top; row <= region.bottom; row += 1) {
      for (let column = region.left; column <= region.right; column += 1) {
        const coordinate = cellName(row, column);
        if (fills[coordinate] !== undefined) continue;
        if (matchesConditionalRule(rule, values[coordinate] ?? "")) fills[coordinate] = color;
      }
    }
  }
  return fills;
}

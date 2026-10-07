/**
 * Conditional formatting on the editor side.
 *
 * A rule stores a target A1 range, a condition and the fill a matching cell
 * shows. The grid asks this module which coordinates currently match, using the
 * same displayed text the grid shows (so a formula cell is compared through its
 * calculated result); a rule never changes stored cell text.
 */

import type { CellValues } from "./formula";
import { cellName, regionFromArea } from "./grid";
import type { FillStyle, FormatCondition, FormatRule } from "./types";

/** Fill styles offered by the dialog, each with its visible background. */
export const FILL_STYLE_OPTIONS: ReadonlyArray<{ value: FillStyle; label: string; color: string }> = [
  { value: "red", label: "Red fill", color: "#fee2e2" },
  { value: "yellow", label: "Yellow fill", color: "#fef9c3" },
  { value: "green", label: "Green fill", color: "#dcfce7" },
];

/** Conditions offered by the dialog. */
export const FORMAT_CONDITION_OPTIONS: ReadonlyArray<{ value: FormatCondition; label: string }> = [
  { value: "greater-than", label: "Greater than" },
  { value: "text-contains", label: "Text contains" },
];

/** Message shown when the `Value` field is empty. */
export const FORMAT_VALUE_REQUIRED_MESSAGE = "Please enter a value";

/** Visible background of a style, or an empty string for an unsupported one. */
export function fillColor(style: FillStyle | string): string {
  return FILL_STYLE_OPTIONS.find((option) => option.value === style)?.color ?? "";
}

/** Visible label of a style. */
export function fillStyleLabel(style: FillStyle | string): string {
  return FILL_STYLE_OPTIONS.find((option) => option.value === style)?.label ?? String(style ?? "");
}

/** Visible label of a condition. */
export function formatConditionLabel(condition: FormatCondition | string): string {
  return FORMAT_CONDITION_OPTIONS.find((option) => option.value === condition)?.label ?? String(condition ?? "");
}

/**
 * True when the displayed text of a cell satisfies the rule. `Greater than`
 * compares parsed numbers (text and blanks never match); `Text contains` looks
 * for the entered text inside the cell value, ignoring letter case.
 */
export function formatRuleMatches(rule: FormatRule, text: string | undefined): boolean {
  const value = String(text ?? "");
  if (rule.condition === "greater-than") {
    const threshold = Number(String(rule.value ?? "").trim());
    if (String(rule.value ?? "").trim() === "" || !Number.isFinite(threshold)) return false;
    const compared = value.trim() === "" ? null : Number(value.trim());
    return compared !== null && Number.isFinite(compared) && compared > threshold;
  }
  if (rule.condition === "text-contains") {
    const needle = String(rule.value ?? "");
    if (needle === "") return false;
    return value.toLowerCase().includes(needle.toLowerCase());
  }
  return false;
}

/**
 * Background colour for every cell a matching rule covers, keyed by coordinate.
 * Rules are applied in order, so the last matching rule of a cell wins.
 */
export function conditionalFills(
  rules: FormatRule[] | undefined,
  values: CellValues,
): Record<string, string> {
  const fills: Record<string, string> = {};
  if (!Array.isArray(rules)) return fills;
  for (const rule of rules) {
    const region = regionFromArea(rule.range);
    const color = fillColor(rule.style);
    if (!region || color === "") continue;
    for (let row = region.top; row <= region.bottom; row += 1) {
      for (let column = region.left; column <= region.right; column += 1) {
        const coordinate = cellName(row, column);
        if (formatRuleMatches(rule, values[coordinate])) fills[coordinate] = color;
      }
    }
  }
  return fills;
}

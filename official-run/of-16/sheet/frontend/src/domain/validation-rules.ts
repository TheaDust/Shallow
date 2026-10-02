import { parseRangeText, rangeText } from "./filter";
import { cellName, type CellRef, type Selection, type ValidationRule } from "./workbook";

/**
 * Client-side view of the worksheet validation rules (REQ-5-2-1).
 *
 * The rules themselves are enforced by the server for every write path (grid,
 * formula bar, paste and range move), which is what keeps a rejected batch
 * atomic. This module only answers what the editor renders and what the "Data
 * validation" dialog saves: which cells are dropdowns, which values their list
 * offers, which rule the current selection refers to, and how a saved rule
 * replaces the rules it overlaps.
 */

export type RuleKind = "list" | "number-between";

/** Allowed values of a dropdown rule (trimmed, empty entries removed). */
export function ruleValues(rule: ValidationRule | null | undefined): string[] {
  if (!rule || rule.type !== "list" || !Array.isArray(rule.values)) return [];
  return rule.values.map((value) => String(value).trim()).filter((value) => value !== "");
}

/** True when the rule is a dropdown rule with at least one allowed value. */
export function isDropdownRule(rule: ValidationRule | null | undefined): boolean {
  return rule?.type === "list" && ruleValues(rule).length > 0;
}

/**
 * Allowed values of the dropdown rule covering one cell, or null when the cell
 * has no dropdown. The first covering rule wins, matching the server's
 * first-match enforcement order.
 */
export function dropdownValuesForCell(
  rules: readonly ValidationRule[] | undefined,
  ref: CellRef,
): string[] | null {
  for (const rule of rules ?? []) {
    const region = parseRangeText(rule.range);
    if (!region) continue;
    const inside = ref.row >= region.minRow && ref.row <= region.maxRow
      && ref.col >= region.minCol && ref.col <= region.maxCol;
    if (!inside) continue;
    const values = ruleValues(rule);
    if (values.length) return values;
  }
  return null;
}

/** Rule whose range covers the selection's active cell; the dialog reopens on it. */
export function ruleForSelection(
  rules: readonly ValidationRule[] | undefined,
  selection: Selection,
): ValidationRule | null {
  for (const rule of rules ?? []) {
    const region = parseRangeText(rule.range);
    if (!region) continue;
    if (selection.focus.row >= region.minRow && selection.focus.row <= region.maxRow
      && selection.focus.col >= region.minCol && selection.focus.col <= region.maxCol) {
      return rule;
    }
  }
  return null;
}

/**
 * Rule list after saving one rule on `targetRange`: every rule that shares a
 * cell with the new range is replaced, so the new range takes effect
 * immediately without two constraints fighting over the same cell.
 */
export function withValidationRule(
  rules: readonly ValidationRule[] | undefined,
  rule: ValidationRule,
  targetRange: string,
): ValidationRule[] {
  const target = parseRangeText(targetRange);
  return (rules ?? []).filter((candidate) => {
    if (candidate.range === rule.range || candidate.range.toUpperCase() === rule.range.toUpperCase()) return false;
    const region = parseRangeText(candidate.range);
    if (!region || !target) return true;
    return !(region.minRow <= target.maxRow && target.minRow <= region.maxRow
      && region.minCol <= target.maxCol && target.minCol <= region.maxCol);
  }).concat(rule);
}

/** Rule list without the rule that covers the current selection ("Delete rule"). */
export function withoutValidationRule(
  rules: readonly ValidationRule[] | undefined,
  rule: ValidationRule | null,
): ValidationRule[] {
  return (rules ?? []).filter((candidate) => candidate !== rule);
}

/** Payload the dialog builds for a dropdown rule of `targetRange`. */
export function dropdownRule(targetRange: string, allowedValues: string): ValidationRule {
  const values = allowedValues.split(",").map((value) => value.trim()).filter((value) => value !== "");
  return { range: targetRange, type: "list", values };
}

/** Payload the dialog builds for a number range rule of `targetRange`. */
export function numberRangeRule(targetRange: string, min: number, max: number): ValidationRule {
  return { range: targetRange, type: "number-between", min, max };
}

/** A1 text of the current selection: the target range of the dialog. */
export function selectionRangeText(selection: Selection): string {
  const anchor = selection.anchor;
  const focus = selection.focus;
  return rangeText({
    minRow: Math.min(anchor.row, focus.row),
    maxRow: Math.max(anchor.row, focus.row),
    minCol: Math.min(anchor.col, focus.col),
    maxCol: Math.max(anchor.col, focus.col),
  });
}

/** Coordinate label used by the "Open dropdown for <coordinate>" buttons. */
export function dropdownLabel(ref: CellRef): string {
  return `Open dropdown for ${cellName(ref)}`;
}

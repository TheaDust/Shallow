/**
 * Data-validation helpers shared by the validation dialog, the grid and the test double.
 *
 * The authoritative rule lives in `backend/src/domain/validation.mjs`; the editor mirrors it
 * so the dialog can prefill from a stored rule, the grid can place its dropdown buttons and the
 * test double can answer the same messages the server would send.
 */

import { cellAddress, parseAddress, type CellSelection, type SelectionBounds } from "./spreadsheet";
import type { ValidationRule } from "./workbook";

/** Message of a rejected number write, mirroring the server's contract wording. */
export function numberRangeMessage(min: number, max: number): string {
  return min === 0 && max === 100
    ? `Please enter a number from ${min} to ${max}`
    : `Please enter a number between ${min} and ${max}`;
}

/** Message of a rejected dropdown write, mirroring the server's contract wording. */
export function dropdownMessage(values: readonly string[]): string {
  return `Please select one of the following values: ${values.join(", ")}`;
}

/** Message when `value` violates `rule`, or null when the value is acceptable. */
export function ruleViolationMessage(rule: ValidationRule, value: string): string | null {
  const text = String(value ?? "");
  if (rule.type === "number-range") {
    const min = Number(rule.min);
    const max = Number(rule.max);
    const numeric = text.trim() === "" ? Number.NaN : Number(text.trim());
    if (Number.isFinite(numeric) && numeric >= min && numeric <= max) return null;
    return rule.message || numberRangeMessage(min, max);
  }
  const allowed = (rule.values ?? []).map((entry) => String(entry));
  if (allowed.includes(text)) return null;
  return rule.message || dropdownMessage(allowed);
}

/** `A1:B2` bounds of a rule range, or null when it is not usable. */
export function ruleRangeBounds(range: string | undefined): SelectionBounds | null {
  if (!range) return null;
  const [start, end = start] = range.split(":");
  const from = parseAddress(start);
  const to = parseAddress(end);
  if (!from || !to) return null;
  return {
    top: Math.min(from.row, to.row),
    bottom: Math.max(from.row, to.row),
    left: Math.min(from.column, to.column),
    right: Math.max(from.column, to.column),
  };
}

/** True when `rule` covers the A1 `address`. */
export function ruleCoversAddress(rule: ValidationRule, address: string): boolean {
  const bounds = ruleRangeBounds(rule.range);
  const position = parseAddress(address);
  if (!bounds || !position) return false;
  return (
    position.row >= bounds.top &&
    position.row <= bounds.bottom &&
    position.column >= bounds.left &&
    position.column <= bounds.right
  );
}

/** The dropdown rule covering `address`, when the cell offers a dropdown. */
export function dropdownRuleFor(
  validations: readonly ValidationRule[] | undefined,
  address: string,
): ValidationRule | undefined {
  return (validations ?? []).find(
    (rule) => rule.type === "dropdown" && ruleCoversAddress(rule, address),
  );
}

/** Message for writing `value` into `address`, or null when no rule rejects it. */
export function validationMessageFor(
  validations: readonly ValidationRule[] | undefined,
  address: string,
  value: string,
): string | null {
  if (String(value ?? "") === "") return null;
  for (const rule of validations ?? []) {
    if (!ruleCoversAddress(rule, address)) continue;
    const message = ruleViolationMessage(rule, value);
    if (message) return message;
  }
  return null;
}

/** Canonical `A1:B2` text of a selection rectangle, used to match a stored rule. */
export function selectionRangeText(selection: CellSelection): string {
  const start = parseAddress(selection.start) ?? { row: 0, column: 0 };
  const end = parseAddress(selection.end) ?? start;
  const top = Math.min(start.row, end.row);
  const bottom = Math.max(start.row, end.row);
  const left = Math.min(start.column, end.column);
  const right = Math.max(start.column, end.column);
  const startAddress = cellAddress(top, left);
  const endAddress = cellAddress(bottom, right);
  // A single cell is submitted in the short form, like the server stores it.
  return startAddress === endAddress ? startAddress : `${startAddress}:${endAddress}`;
}
/** The stored rule that covers exactly the same rectangle as `selection`, if any. */
export function ruleForSelection(
  validations: readonly ValidationRule[] | undefined,
  selection: CellSelection,
): ValidationRule | undefined {
  const wanted = ruleRangeBounds(selectionRangeText(selection));
  if (!wanted) return undefined;
  return (validations ?? []).find((rule) => {
    const bounds = ruleRangeBounds(rule.range);
    return (
      bounds !== null &&
      bounds.top === wanted.top &&
      bounds.bottom === wanted.bottom &&
      bounds.left === wanted.left &&
      bounds.right === wanted.right
    );
  });
}

/**
 * Allowed values of the `Allowed values` text box: comma-separated items trimmed of leading
 * and trailing spaces, blanks dropped, duplicates removed.
 */
export function allowedValuesFromText(text: string): string[] {
  const values: string[] = [];
  for (const part of String(text ?? "").split(",")) {
    const trimmed = part.trim();
    if (trimmed !== "" && !values.includes(trimmed)) values.push(trimmed);
  }
  return values;
}

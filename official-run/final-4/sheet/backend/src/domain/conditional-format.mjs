/**
 * Conditional formatting rules: a stored rule combines a target A1 area, one
 * condition, the value it compares against and the fill style a matching cell
 * shows. The rule only describes an appearance, so no cell value is ever
 * rewritten by saving, editing or deleting one; the grid derives the visible
 * fills from the stored rules and the displayed cell values.
 *
 * The helpers are pure and validate the whole payload before the store's single
 * atomic write, so a rejected rule leaves the stored rules untouched.
 */

import { ValidationError } from "../lib/errors.mjs";
import { cellName, parseArea } from "./grid.mjs";
import { shiftArea } from "./structure.mjs";

/** Condition names of the "Condition" field, in dialog order. */
export const CONDITIONAL_CONDITIONS = ["Greater than", "Text contains"];
/** Style names of the "Style" field, in dialog order. */
export const CONDITIONAL_STYLES = ["Red fill", "Yellow fill", "Green fill"];
/** Exact message of a rule whose range, condition, value or style is unusable. */
export const INVALID_CONDITIONAL_FORMAT_MESSAGE = "Invalid conditional formatting rule";
/** Exact message of an update/delete that names no stored rule. */
export const UNKNOWN_CONDITIONAL_FORMAT_MESSAGE = "Unknown conditional formatting rule";

/** Canonical A1 area of a rule, ignoring an optional `Sheet!` qualifier. */
function normalizeArea(value) {
  if (typeof value !== "string") throw new ValidationError(INVALID_CONDITIONAL_FORMAT_MESSAGE);
  const text = value.trim();
  const separator = text.indexOf("!");
  const areaText = (separator >= 0 ? text.slice(separator + 1) : text).replace(/\$/g, "").trim();
  const bounds = parseArea(areaText);
  if (!bounds) throw new ValidationError(INVALID_CONDITIONAL_FORMAT_MESSAGE);
  const start = cellName(bounds.top, bounds.left);
  const end = cellName(bounds.bottom, bounds.right);
  return start === end ? start : `${start}:${end}`;
}

/** Validated, canonical rule payload, or throws `ValidationError`. */
export function normalizeConditionalFormat({ range, condition, value, style } = {}) {
  const area = normalizeArea(range);
  if (!CONDITIONAL_CONDITIONS.includes(condition)) {
    throw new ValidationError(INVALID_CONDITIONAL_FORMAT_MESSAGE);
  }
  const compared = typeof value === "string" ? value.trim() : "";
  if (compared === "") throw new ValidationError(INVALID_CONDITIONAL_FORMAT_MESSAGE);
  if (!CONDITIONAL_STYLES.includes(style)) {
    throw new ValidationError(INVALID_CONDITIONAL_FORMAT_MESSAGE);
  }
  return { range: area, condition, value: compared, style };
}

/**
 * Rules of one worksheet after a row/column change of that worksheet: each
 * target range follows the cells it covers, and a rule completely covered by a
 * deleted line is dropped.
 */
export function shiftConditionalFormats(rules, { axis, mode, index } = {}) {
  if (!Array.isArray(rules) || rules.length === 0) return rules;
  const at = mode === "insert-after" ? index + 1 : index;
  const change = mode === "delete" ? "delete" : "insert-before";
  const next = [];
  for (const rule of rules) {
    const range = shiftArea(rule?.range, axis, change, at);
    if (!range) continue;
    next.push({ ...rule, range });
  }
  return next;
}

/**
 * Conditional formatting rules of one worksheet: a rule watches an A1 range and
 * paints every matching cell with one visible fill style. A rule stores the
 * range, the condition type, the required comparison value and the style; the
 * fill color itself is a frontend rendering concern, the stored style name is
 * the single authority both sides share.
 *
 * "Greater than" applies to parseable numeric values, "Text contains" to text
 * values. The whole rule is validated before the atomic write, so a rejected
 * payload leaves the stored rules unchanged.
 */

import { ValidationError } from "../lib/errors.mjs";
import { cellName, parseArea } from "./grid.mjs";

/** Condition options offered by the "Condition" field. */
export const GREATER_THAN_CONDITION = "Greater than";
export const TEXT_CONTAINS_CONDITION = "Text contains";
export const CONDITIONAL_CONDITIONS = [GREATER_THAN_CONDITION, TEXT_CONTAINS_CONDITION];

/** Style options offered by the "Style" field; the names are the stored values. */
export const CONDITIONAL_STYLES = ["Red fill", "Yellow fill", "Green fill"];

export const INVALID_CONDITIONAL_FORMAT_MESSAGE = "Invalid conditional formatting rule";
export const MISSING_CONDITIONAL_VALUE_MESSAGE = "Value is required";
export const MISSING_CONDITIONAL_RULE_MESSAGE = "Conditional formatting rule not found";

/** Canonical A1 area of a rule target, or throws `ValidationError`. */
export function normalizeConditionalRange(value) {
  const bounds = typeof value === "string" ? parseArea(value) : null;
  if (!bounds) throw new ValidationError(INVALID_CONDITIONAL_FORMAT_MESSAGE);
  const start = cellName(bounds.top, bounds.left);
  const end = cellName(bounds.bottom, bounds.right);
  return start === end ? start : `${start}:${end}`;
}

/**
 * Validated rule payload (`range`, `condition`, `value`, `style`), or throws
 * `ValidationError`. The comparison value is required and trimmed.
 */
export function normalizeConditionalFormat({ range, condition, value, style } = {}) {
  const target = normalizeConditionalRange(range);
  if (!CONDITIONAL_CONDITIONS.includes(condition)) {
    throw new ValidationError(INVALID_CONDITIONAL_FORMAT_MESSAGE);
  }
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new ValidationError(MISSING_CONDITIONAL_VALUE_MESSAGE);
  if (!CONDITIONAL_STYLES.includes(style)) throw new ValidationError(INVALID_CONDITIONAL_FORMAT_MESSAGE);
  return { range: target, condition, value: text, style };
}

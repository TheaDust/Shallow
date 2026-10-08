/**
 * Conditional formatting rules for one worksheet.
 *
 * A worksheet may carry a `conditionalFormats` array of
 * `{ range, condition, value, style }` entries. The rule is applied by the
 * client while rendering: a cell inside `range` whose displayed value matches
 * `condition`/`value` shows the visible `style` fill. This module owns the
 * vocabulary (the exact condition and style names the dialog offers, and the
 * fill each style paints) and validates a submitted rule, so a rejected save
 * never reaches the stored state.
 */

import { ValidationError } from "../lib/errors.mjs";
import { cellName, parseArea } from "./grid.mjs";

export const CONDITION_GREATER_THAN = "Greater than";
export const CONDITION_TEXT_CONTAINS = "Text contains";
export const CONDITIONAL_CONDITIONS = [CONDITION_GREATER_THAN, CONDITION_TEXT_CONTAINS];

export const STYLE_RED = "Red fill";
export const STYLE_YELLOW = "Yellow fill";
export const STYLE_GREEN = "Green fill";
export const CONDITIONAL_STYLES = [STYLE_RED, STYLE_YELLOW, STYLE_GREEN];

/** Visible background each style paints; the client renders exactly these. */
export const FILL_COLORS = {
  [STYLE_RED]: "rgb(254, 226, 226)",
  [STYLE_YELLOW]: "rgb(254, 249, 195)",
  [STYLE_GREEN]: "rgb(220, 252, 231)",
};

export const INVALID_FORMAT_MESSAGE = "Invalid conditional formatting rule";
export const VALUE_REQUIRED_MESSAGE = "Please enter a value";
export const VALUE_NOT_NUMBER_MESSAGE = "Please enter a number";

/**
 * Validated rule with a canonical A1 range, or throws `ValidationError`. The
 * `Value` is required; a `Greater than` rule additionally needs a parseable
 * number, because it only applies to numeric cells.
 */
export function normalizeConditionalFormat({ range, condition, value, style } = {}) {
  const bounds = typeof range === "string" ? parseArea(range) : null;
  if (!bounds) throw new ValidationError(INVALID_FORMAT_MESSAGE);
  if (!CONDITIONAL_CONDITIONS.includes(condition)) throw new ValidationError(INVALID_FORMAT_MESSAGE);
  if (!CONDITIONAL_STYLES.includes(style)) throw new ValidationError(INVALID_FORMAT_MESSAGE);
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new ValidationError(VALUE_REQUIRED_MESSAGE);
  if (condition === CONDITION_GREATER_THAN && !Number.isFinite(Number(text))) {
    throw new ValidationError(VALUE_NOT_NUMBER_MESSAGE);
  }
  const start = cellName(bounds.top, bounds.left);
  const end = cellName(bounds.bottom, bounds.right);
  return { range: start === end ? start : `${start}:${end}`, condition, value: text, style };
}

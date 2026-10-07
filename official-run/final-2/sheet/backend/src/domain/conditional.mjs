/**
 * Conditional formatting rules of a worksheet.
 *
 * A worksheet may carry a `conditionalRules` array of
 * `{ range, condition, value, style }` entries. The rules are display-only:
 * the editor paints the cells of `range` whose value satisfies the condition
 * with the chosen fill, while cell values, formulas and validation rules stay
 * untouched. This module owns the accepted condition/style names, the
 * canonical area text and the rejection message; the store persists the list
 * atomically in rule order (the order also decides which fill wins).
 */

import { ValidationError } from "../lib/errors.mjs";
import { INVALID_RULE_MESSAGE, normalizeRuleRange } from "./validation.mjs";

export const GREATER_THAN_CONDITION = "greater-than";
export const TEXT_CONTAINS_CONDITION = "text-contains";
export const CONDITIONAL_CONDITIONS = [GREATER_THAN_CONDITION, TEXT_CONTAINS_CONDITION];

export const RED_FILL_STYLE = "red-fill";
export const YELLOW_FILL_STYLE = "yellow-fill";
export const GREEN_FILL_STYLE = "green-fill";
export const CONDITIONAL_STYLES = [RED_FILL_STYLE, YELLOW_FILL_STYLE, GREEN_FILL_STYLE];

export const INVALID_CONDITIONAL_MESSAGE = "Invalid conditional formatting rule";

/**
 * Validated, canonical rule payload, or throws `ValidationError`. The area is
 * stored as canonical A1 text (a single cell stays `A1`), the condition and the
 * style must be one of the supported names and the value is required, so a rule
 * can never be stored half-configured.
 */
export function normalizeConditionalRule({ range, condition, value, style } = {}) {
  let area;
  try {
    area = normalizeRuleRange(range);
  } catch (error) {
    if (error instanceof ValidationError && error.message === INVALID_RULE_MESSAGE) {
      throw new ValidationError(INVALID_CONDITIONAL_MESSAGE);
    }
    throw error;
  }
  if (!CONDITIONAL_CONDITIONS.includes(condition)) throw new ValidationError(INVALID_CONDITIONAL_MESSAGE);
  if (!CONDITIONAL_STYLES.includes(style)) throw new ValidationError(INVALID_CONDITIONAL_MESSAGE);
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") throw new ValidationError(INVALID_CONDITIONAL_MESSAGE);
  return { range: area, condition, value: text, style };
}

/** Position of a rule in the worksheet's stored list, or throws. */
export function normalizeConditionalIndex(index) {
  if (!Number.isInteger(index) || index < 0) throw new ValidationError(INVALID_CONDITIONAL_MESSAGE);
  return index;
}

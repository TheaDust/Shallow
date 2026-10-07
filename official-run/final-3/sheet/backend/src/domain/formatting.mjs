/**
 * Conditional formatting rules of a worksheet: a target A1 range, the numeric
 * or textual condition a cell has to satisfy, and the fill style a matching
 * cell shows. Rules only describe a display effect — they never change stored
 * cell text — so the store keeps them beside the worksheet's other view state.
 *
 * The module is pure: it validates and canonicalises a rule payload; the store
 * performs the atomic write.
 */

import { canonicalArea } from "./named-ranges.mjs";

export const GREATER_THAN = "greater-than";
export const TEXT_CONTAINS = "text-contains";
/** Condition kinds a rule may use. */
export const FORMAT_CONDITIONS = [GREATER_THAN, TEXT_CONTAINS];

export const FILL_STYLES = ["red", "yellow", "green"];

/** Message shown for an unsupported condition, style or range. */
export const INVALID_FORMAT_RULE_MESSAGE = "Invalid conditional formatting rule";
/** Message shown when the value a rule compares against is missing. */
export const FORMAT_VALUE_REQUIRED_MESSAGE = "Please enter a value";

/**
 * The stored rule built from a payload, or the message that rejects it. The
 * range is canonicalised, the value is trimmed, and the condition and style
 * have to be ones the dialog offers.
 */
export function normalizeFormatRule({ range, condition, value, style } = {}) {
  const bounds = canonicalArea(range);
  if (!bounds) return { error: INVALID_FORMAT_RULE_MESSAGE };
  if (!FORMAT_CONDITIONS.includes(condition)) return { error: INVALID_FORMAT_RULE_MESSAGE };
  if (!FILL_STYLES.includes(style)) return { error: INVALID_FORMAT_RULE_MESSAGE };
  if (typeof value !== "string" || value.trim() === "") return { error: FORMAT_VALUE_REQUIRED_MESSAGE };
  return { rule: { range: bounds, condition, value: value.trim(), style } };
}

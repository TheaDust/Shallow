/**
 * Data-validation rules for worksheet ranges.
 *
 * A worksheet may carry a `validationRules` array of `{ range, type, ... }`
 * entries. Writes through the single-cell and bulk endpoints are checked
 * against every rule covering the target coordinate; the first rejected value
 * makes the whole write fail, so a bulk paste never leaves a partially valid
 * rectangle. Rule creation UI belongs to the data-validation feature; this
 * module is the shared enforcement boundary both write paths use.
 */

import { parseCellName } from "./grid.mjs";

export const NUMBER_RANGE_TYPE = "number-range";
export const DROPDOWN_TYPE = "dropdown";

/** Message shown for an out-of-range number; the 0-to-100 range has its own wording. */
export function numberRangeMessage(min, max) {
  return min === 0 && max === 100
    ? "Please enter a number from 0 to 100"
    : `Please enter a number between ${min} and ${max}`;
}

export function dropdownMessage(values) {
  return `Please select one of the following values: ${values.join(", ")}`;
}

/** Rectangle covered by a rule range such as `A1:A2` or `A1:B2`, or `null`. */
function ruleBounds(rule) {
  const [start, end = start] = String(rule?.range ?? "").split(":");
  const first = parseCellName(start);
  const last = parseCellName(end);
  if (!first || !last) return null;
  return {
    top: Math.min(first.row, last.row),
    bottom: Math.max(first.row, last.row),
    left: Math.min(first.column, last.column),
    right: Math.max(first.column, last.column),
  };
}

/** First rule covering `coordinate`, or `null`. */
export function findRule(rules, coordinate) {
  const position = parseCellName(coordinate);
  if (!position || !Array.isArray(rules)) return null;
  for (const rule of rules) {
    const bounds = ruleBounds(rule);
    if (!bounds) continue;
    if (
      position.row >= bounds.top &&
      position.row <= bounds.bottom &&
      position.column >= bounds.left &&
      position.column <= bounds.right
    ) {
      return rule;
    }
  }
  return null;
}

/** Error message for a value rejected by `rule`, or `null` when it is accepted. */
export function validateCellValue(rule, value) {
  if (!rule || typeof rule !== "object") return null;
  if (rule.type === NUMBER_RANGE_TYPE) {
    const text = String(value).trim();
    if (!text) return null;
    const number = Number(text);
    if (!Number.isFinite(number) || number < rule.min || number > rule.max) {
      return numberRangeMessage(rule.min, rule.max);
    }
    return null;
  }
  if (rule.type === DROPDOWN_TYPE) {
    if (String(value) === "") return null;
    const allowed = Array.isArray(rule.values) ? rule.values : [];
    return allowed.includes(value) ? null : dropdownMessage(allowed);
  }
  return null;
}

/** First rule violation among `{ coordinate, value }` updates, or `null`. */
export function firstValidationError(rules, updates) {
  if (!Array.isArray(rules) || rules.length === 0) return null;
  for (const update of updates) {
    const rule = findRule(rules, update.coordinate);
    if (!rule) continue;
    const error = validateCellValue(rule, update.value);
    if (error) return error;
  }
  return null;
}

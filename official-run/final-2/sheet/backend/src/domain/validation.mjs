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

import { ValidationError } from "../lib/errors.mjs";
import { cellName, parseCellName } from "./grid.mjs";

export const NUMBER_RANGE_TYPE = "number-range";

export const DROPDOWN_TYPE = "dropdown";
export const INVALID_RULE_MESSAGE = "Invalid validation rule";

/** Message shown for an out-of-range number; the 0-to-100 range has its own wording. */
export function numberRangeMessage(min, max) {
  return min === 0 && max === 100
    ? "Please enter a number from 0 to 100"
    : `Please enter a number between ${min} and ${max}`;
}

export function dropdownMessage(values) {
  return `Please select one of the following values: ${values.join(", ")}`;
}

/**
 * Canonical A1 area for a rule: a single cell stays `A1`, a rectangle becomes
 * `A1:B2` with top-left/bottom-right ordering. Throws `ValidationError` for
 * anything that is not an A1 cell or area.
 */
export function normalizeRuleRange(value) {
  if (typeof value !== "string") throw new ValidationError(INVALID_RULE_MESSAGE);
  const parts = value.trim().split(":");
  if (parts.length < 1 || parts.length > 2) throw new ValidationError(INVALID_RULE_MESSAGE);
  const first = parseCellName(parts[0]);
  const last = parts.length === 2 ? parseCellName(parts[1]) : first;
  if (!first || !last) throw new ValidationError(INVALID_RULE_MESSAGE);
  const top = Math.min(first.row, last.row);
  const bottom = Math.max(first.row, last.row);
  const left = Math.min(first.column, last.column);
  const right = Math.max(first.column, last.column);
  const start = cellName(top, left);
  const end = cellName(bottom, right);
  return start === end ? start : `${start}:${end}`;
}

/**
 * Validated, canonical rule payload, or throws `ValidationError`. An optional
 * `errorMessage` is stored trimmed and only when it is not empty: it replaces
 * the standard rejection text of every invalid entry path, and clearing it
 * restores the standard text.
 */
export function normalizeRule({ range, type, min, max, values, errorMessage } = {}) {
  const normalizedRange = normalizeRuleRange(range);
  const custom = typeof errorMessage === "string" ? errorMessage.trim() : "";
  if (type === NUMBER_RANGE_TYPE) {
    const low = typeof min === "number" ? min : Number(min);
    const high = typeof max === "number" ? max : Number(max);
    if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) {
      throw new ValidationError(INVALID_RULE_MESSAGE);
    }
    const rule = { range: normalizedRange, type, min: low, max: high };
    return custom ? { ...rule, errorMessage: custom } : rule;
  }
  if (type === DROPDOWN_TYPE) {
    const allowed = Array.isArray(values)
      ? values.map((value) => String(value).trim()).filter((value) => value !== "")
      : [];
    if (allowed.length === 0) throw new ValidationError(INVALID_RULE_MESSAGE);
    const rule = { range: normalizedRange, type, values: allowed };
    return custom ? { ...rule, errorMessage: custom } : rule;
  }
  throw new ValidationError(INVALID_RULE_MESSAGE);
}

/** True when two rule ranges cover the same rectangle. */
export function sameRuleRange(a, b) {
  try {
    return normalizeRuleRange(a) === normalizeRuleRange(b);
  } catch {
    return false;
  }
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

/** Custom replacement message of a rule, or `null` when it carries none. */
export function customErrorMessage(rule) {
  const text = typeof rule?.errorMessage === "string" ? rule.errorMessage.trim() : "";
  return text === "" ? null : text;
}

/** Standard rejection text of a value, or `null` when the rule accepts it. */
function standardError(rule, value) {
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

/**
 * Error message for a value rejected by `rule`, or `null` when it is accepted.
 * A nonempty `errorMessage` of the rule replaces the standard text, so every
 * entry path (grid, formula bar, paste, range move) reports the custom text.
 */
export function validateCellValue(rule, value) {
  if (!rule || typeof rule !== "object") return null;
  const standard = standardError(rule, value);
  if (!standard) return null;
  return customErrorMessage(rule) ?? standard;
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

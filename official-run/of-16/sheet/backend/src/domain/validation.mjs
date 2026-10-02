/**
 * Cell validation rules for one worksheet (REQ-5-2).
 *
 * A worksheet may carry a `validations` array; each rule covers an A1 range and
 * rejects written values that do not satisfy it. The rules are checked before a
 * cell batch is applied, so a rejected edit, paste or range move leaves every
 * target cell with its previous value (no partial write). This module is both
 * the enforcement point used by cell writes and the payload normalizer of the
 * "Data validation" dialog.
 *
 * Supported rule types:
 * - `list`        — dropdown; the written text must equal one of `values`
 *                   (compared after trimming, the stored text stays as typed);
 * - `number-between` / `number` — a numeric value inside an inclusive range.
 */
import { DomainError } from "./errors.mjs";
import { parseCellName } from "./grid.mjs";

/**
 * Parses `A1` or `A1:B2` into a rectangle. Returns null for anything else so an
 * unparsable stored rule can never reject a legitimate value.
 */
export function parseRange(text) {
  const parts = String(text ?? "").split(":");
  if (parts.length > 2) return null;
  const first = parseCellName(parts[0]);
  if (!first) return null;
  const second = parts.length === 2 ? parseCellName(parts[1]) : first;
  if (!second) return null;
  return {
    minRow: Math.min(first.row, second.row),
    maxRow: Math.max(first.row, second.row),
    minCol: Math.min(first.col, second.col),
    maxCol: Math.max(first.col, second.col),
  };
}

export function isInsideRange(ref, region) {
  return ref.row >= region.minRow && ref.row <= region.maxRow
    && ref.col >= region.minCol && ref.col <= region.maxCol;
}

/** Allowed values of a dropdown rule, trimmed and without empty entries. */
export function allowedValues(rule) {
  if (!Array.isArray(rule?.values)) return [];
  return rule.values.map((value) => String(value).trim()).filter((value) => value !== "");
}

/** Message shown next to the edited control; a stored rule message wins. */
export function validationMessage(rule) {
  const stored = typeof rule?.message === "string" ? rule.message.trim() : "";
  if (stored) return stored;
  if (rule?.type === "list") {
    const values = allowedValues(rule);
    if (values.length) return `Please select one of the following values: ${values.join(", ")}`;
  }
  const min = Number(rule?.min);
  const max = Number(rule?.max);
  if (rule?.type === "number-between" && Number.isFinite(min) && Number.isFinite(max)) {
    return `Please enter a number from ${min} to ${max}`;
  }
  return "Please enter a valid value";
}

/**
 * Returns the first rejection message for one written value, or null when the
 * value is acceptable. Blank text is allowed unless the rule opts out with
 * `allowBlank: false`, so existing empty cells stay writable.
 */
export function checkValidationError(worksheet, ref, rawValue) {
  const rules = Array.isArray(worksheet?.validations) ? worksheet.validations : [];
  const text = rawValue === null || rawValue === undefined ? "" : String(rawValue);
  for (const rule of rules) {
    const region = parseRange(rule?.range);
    if (!region || !isInsideRange(ref, region)) continue;
    if (text.trim() === "") {
      if (rule.allowBlank === false) return validationMessage(rule);
      continue;
    }
    const numeric = Number(text);
    if (rule.type === "number-between") {
      const min = Number(rule.min);
      const max = Number(rule.max);
      if (!Number.isFinite(numeric) || numeric < min || numeric > max) return validationMessage(rule);
    } else if (rule.type === "number") {
      if (!Number.isFinite(numeric)) return validationMessage(rule);
    } else if (rule.type === "list") {
      const values = allowedValues(rule);
      if (!values.length) continue;
      if (!values.includes(text.trim())) return validationMessage(rule);
    }
  }
  return null;
}

function normalizedRange(rawRange) {
  const range = typeof rawRange === "string" ? rawRange.trim().toUpperCase() : "";
  if (!parseRange(range)) throw new DomainError(`Invalid validation range: ${rawRange}`, 400);
  return range;
}

/** Validates and normalizes one rule submitted by the validation dialog. */
function normalizeRule(rule) {
  const range = normalizedRange(rule?.range);
  const type = rule?.type;
  const next = { range, type };
  if (rule?.allowBlank === false) next.allowBlank = false;
  const message = typeof rule?.message === "string" ? rule.message.trim() : "";
  if (message) next.message = message;

  if (type === "list") {
    const values = Array.isArray(rule.values) ? rule.values.map((value) => String(value).trim()).filter((value) => value !== "") : [];
    if (!values.length) throw new DomainError("A dropdown rule needs at least one allowed value", 400);
    return { ...next, values };
  }
  if (type === "number-between") {
    const min = Number(rule.min);
    const max = Number(rule.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new DomainError("A number range rule needs a minimum and a maximum", 400);
    }
    return { ...next, min, max };
  }
  if (type === "number") return next;
  throw new DomainError(`Unknown validation rule type: ${type}`, 400);
}

/**
 * Normalizes the complete rule list of one worksheet. The whole payload is
 * checked before anything is stored, so an invalid rule leaves the previously
 * stored rules exactly as they were.
 */
export function normalizeValidationRules(input) {
  if (!Array.isArray(input)) throw new DomainError("validations must be an array", 400);
  return input.map((rule) => normalizeRule(rule));
}

/** True when two A1 ranges share at least one coordinate. */
export function rangesIntersect(left, right) {
  return left.minRow <= right.maxRow && right.minRow <= left.maxRow
    && left.minCol <= right.maxCol && right.minCol <= left.maxCol;
}

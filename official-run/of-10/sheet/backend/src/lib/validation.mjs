import { parseCellId, parseRegionRef, regionHasCell } from "./cells.mjs";
import { WorkbookError } from "./errors.mjs";

/**
 * Data validation rules of one worksheet. A rule constrains every cell inside its rectangle:
 * `numberRange` accepts a number between `min` and `max`, `dropdown` accepts one of
 * `allowedValues`. An empty value always clears a cell. `message` overrides the generated text so a
 * persisted rule (for example the 0-to-100 boundary rule) can keep its own wording.
 */

export const NUMBER_RANGE = "numberRange";
export const DROPDOWN = "dropdown";
export const DEFAULT_NUMBER_RANGE_MESSAGE = (min, max) => `Please enter a number between ${min} and ${max}`;
export const BOUNDARY_RULE_MESSAGE = "Please enter a number from 0 to 100";

export function ruleMessage(rule) {
  if (typeof rule?.message === "string" && rule.message !== "") return rule.message;
  if (rule?.type === DROPDOWN) {
    return `Please select one of the following values: ${(rule.allowedValues ?? []).join(", ")}`;
  }
  return DEFAULT_NUMBER_RANGE_MESSAGE(String(rule?.min ?? 0), String(rule?.max ?? 0));
}

/** Returns the error message when `rawText` violates the rule, or null when it is acceptable. */
export function ruleViolation(rule, rawText) {
  const text = typeof rawText === "string" ? rawText : "";
  if (text === "") return null;
  if (rule?.type === DROPDOWN) {
    const allowed = Array.isArray(rule.allowedValues) ? rule.allowedValues : [];
    return allowed.includes(text) ? null : ruleMessage(rule);
  }
  const trimmed = text.trim();
  const value = Number(trimmed);
  if (trimmed === "" || !Number.isFinite(value)) return ruleMessage(rule);
  const min = typeof rule.min === "number" ? rule.min : Number.NEGATIVE_INFINITY;
  const max = typeof rule.max === "number" ? rule.max : Number.POSITIVE_INFINITY;
  return value >= min && value <= max ? null : ruleMessage(rule);
}

/** First rule that rejects one of the writes; the whole write operation is rejected on a hit. */
export function findViolation(worksheet, entries) {
  const rules = Array.isArray(worksheet?.validations) ? worksheet.validations : [];
  if (rules.length === 0) return null;
  for (const entry of entries) {
    if (typeof entry.value !== "string" || entry.value === "") continue;
    const address = parseCellId(entry.cellId);
    if (!address) continue;
    for (const rule of rules) {
      if (!regionHasCell(rule.range, address)) continue;
      const message = ruleViolation(rule, entry.value);
      if (message) return { cellId: entry.cellId, message };
    }
  }
  return null;
}

/** Normalizes the payload of the validation write endpoint into a stored rule. */
export function normalizeValidationRule(payload, makeId) {
  const range = parseRegionRef(payload?.range);
  if (!range) throw new WorkbookError("Enter a valid range such as A1:B2");

  const requestedType = String(payload?.type ?? "").trim();
  const isDropdown = /^dropdown$/i.test(requestedType);
  const isNumber = /^(number|numberRange|number range)$/i.test(requestedType);
  if (!isDropdown && !isNumber) throw new WorkbookError("Unknown validation rule type");

  const message = typeof payload?.message === "string" && payload.message !== "" ? payload.message : undefined;

  if (isDropdown) {
    const allowedValues = [];
    const requested = Array.isArray(payload?.allowedValues) ? payload.allowedValues : [];
    for (const value of requested) {
      const text = String(value).trim();
      if (text !== "" && !allowedValues.includes(text)) allowedValues.push(text);
    }
    if (allowedValues.length === 0) throw new WorkbookError("Enter at least one allowed value");
    return { id: makeId(), type: DROPDOWN, range, allowedValues, ...(message ? { message } : {}) };
  }

  const min = Number(payload?.min);
  const max = Number(payload?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) throw new WorkbookError("Enter a numeric minimum and maximum");
  return { id: makeId(), type: NUMBER_RANGE, range, min, max, ...(message ? { message } : {}) };
}

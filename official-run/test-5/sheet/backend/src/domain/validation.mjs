/**
 * Data-validation rules of a worksheet.
 *
 * A rule owns a rectangular `range` and a `type`; this module knows how to
 * normalize a rule, tell whether it covers a coordinate and check a raw cell
 * text against it. Only the constraint types implemented so far are accepted,
 * so a stored worksheet never holds a rule the write path cannot enforce.
 *
 * Two types are supported: a `number-between` numeric range and a `dropdown`
 * list of allowed values. Every rule keeps the `message` shown when a write is
 * rejected, so a rule created elsewhere keeps its own wording while the
 * "Data validation" dialog (REQ-5-2-1) names the bound or the allowed values.
 */

import { cellAddress, parseCellAddress } from "./coordinates.mjs";

export const INVALID_VALIDATION_MESSAGE = "Invalid validation rule";
export const NUMBER_BETWEEN = "number-between";
export const DROPDOWN = "dropdown";

export const VALIDATION_TYPES = Object.freeze([DROPDOWN, NUMBER_BETWEEN]);

/** Prompt of a numeric range rule stored without an explicit message. */
export function numberBetweenMessage(min, max) {
  return `Please enter a number from ${min} to ${max}`;
}

/** Prompt of a numeric range rule created through the "Data validation" dialog. */
export function numberRangeMessage(min, max) {
  return `Please enter a number between ${min} and ${max}`;
}

/** Prompt of a dropdown rule, listing the allowed values as stored. */
export function dropdownMessage(values) {
  return `Please select one of the following values: ${values.join(", ")}`;
}

/** Splits the comma-separated "Allowed values" text, trimming each item. */
export function parseAllowedValues(text) {
  if (typeof text !== "string") return [];
  return text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/** True when the cell text is one of the allowed values of a dropdown rule. */
export function matchesDropdownValue(rule, text) {
  const values = Array.isArray(rule.values) ? rule.values : [];
  return values.includes(String(text ?? "").trim());
}

/** Normalizes `"D1:E2"`, `"D1"` or `{start,end}` into a rectangle, or null. */
export function normalizeValidationRange(value) {
  const text = typeof value === "string"
    ? value.trim()
    : value && typeof value === "object"
      ? `${value.start ?? ""}:${value.end ?? value.start ?? ""}`
      : "";
  const match = /^([A-Za-z]{1,3}[0-9]{1,7})(?::([A-Za-z]{1,3}[0-9]{1,7}))?$/.exec(text);
  if (!match) return null;
  const start = parseCellAddress(match[1]);
  const end = match[2] ? parseCellAddress(match[2]) : start;
  if (!start || !end) return null;
  return {
    start: cellAddress(Math.min(start.column, end.column), Math.min(start.row, end.row)),
    end: cellAddress(Math.max(start.column, end.column), Math.max(start.row, end.row)),
  };
}

function normalizeNumber(value) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(number) ? number : null;
}

/**
 * Normalizes one submitted rule. Returns `{ ok: true, rule }` or
 * `{ ok: false, error }`; unknown keys are dropped so the stored shape stays
 * predictable for every consumer.
 */
export function normalizeValidation(input, index = 0) {
  if (!input || typeof input !== "object") return { ok: false, error: INVALID_VALIDATION_MESSAGE };
  const range = normalizeValidationRange(input.range);
  if (!range) return { ok: false, error: INVALID_VALIDATION_MESSAGE };
  const id = typeof input.id === "string" && input.id.trim() !== "" ? input.id.trim() : `rule-${index + 1}`;
  const hasMessage = typeof input.message === "string" && input.message.trim() !== "";
  if (input.type === DROPDOWN) {
    const values = Array.isArray(input.values)
      ? input.values.map((value) => String(value ?? "").trim()).filter((value) => value !== "")
      : [];
    if (values.length === 0) return { ok: false, error: INVALID_VALIDATION_MESSAGE };
    return {
      ok: true,
      rule: {
        id,
        range,
        type: DROPDOWN,
        values,
        message: hasMessage ? input.message.trim() : dropdownMessage(values),
      },
    };
  }
  if (input.type !== NUMBER_BETWEEN) return { ok: false, error: INVALID_VALIDATION_MESSAGE };
  const min = normalizeNumber(input.min);
  const max = normalizeNumber(input.max);
  if (min === null || max === null || min > max) return { ok: false, error: INVALID_VALIDATION_MESSAGE };
  const message = hasMessage ? input.message.trim() : numberBetweenMessage(min, max);
  return { ok: true, rule: { id, range, type: NUMBER_BETWEEN, min, max, message } };
}

export function normalizeValidations(value) {
  if (!Array.isArray(value)) return { ok: false, error: INVALID_VALIDATION_MESSAGE };
  const rules = [];
  for (let index = 0; index < value.length; index += 1) {
    const normalized = normalizeValidation(value[index], index);
    if (!normalized.ok) return normalized;
    rules.push(normalized.rule);
  }
  return { ok: true, rules };
}

export function ruleCovers(rule, address) {
  const coordinate = parseCellAddress(address);
  const start = parseCellAddress(rule.range.start);
  const end = parseCellAddress(rule.range.end);
  if (!coordinate || !start || !end) return false;
  return (
    coordinate.column >= start.column
    && coordinate.column <= end.column
    && coordinate.row >= start.row
    && coordinate.row <= end.row
  );
}

export function validationMessage(rule) {
  if (typeof rule.message === "string" && rule.message !== "") return rule.message;
  return rule.type === DROPDOWN
    ? dropdownMessage(Array.isArray(rule.values) ? rule.values : [])
    : numberBetweenMessage(rule.min, rule.max);
}

/**
 * Checks one raw cell text against one rule. Blank input is allowed (a blank
 * cell is never a violation), a numeric text must be inside the bounds and any
 * other text is rejected with the rule's message.
 */
export function checkValidationRule(rule, rawText) {
  const text = typeof rawText === "string" ? rawText.trim() : "";
  if (text === "") return null;
  if (rule.type === NUMBER_BETWEEN) {
    const number = Number(text);
    if (!Number.isFinite(number) || number < rule.min || number > rule.max) return validationMessage(rule);
  } else if (rule.type === DROPDOWN) {
    if (!matchesDropdownValue(rule, text)) return validationMessage(rule);
  }
  return null;
}

/** First rule violation of one cell, or null. */
export function validateCellText(worksheet, address, rawText) {
  const rules = Array.isArray(worksheet.validations) ? worksheet.validations : [];
  for (const rule of rules) {
    if (!ruleCovers(rule, address)) continue;
    const error = checkValidationRule(rule, rawText);
    if (error) return error;
  }
  return null;
}

import { isCellCoordinate, parseCellCoordinate } from "./spreadsheet.mjs";

/**
 * Data-validation rules of one worksheet (REQ-5-2). A rule is a region-bearing record:
 *
 * - `{ id, type: "dropdown", range: { start, end }, values: ["East", …] }`
 * - `{ id, type: "number-range", range: { start, end }, min, max, message }`
 *
 * Every write path (grid / formula bar, paste, range move) goes through `validationRejection`, so a
 * rule refuses the whole operation before anything is written. The 0-to-100 rule keeps the message
 * the earlier paste requirements declare verbatim; every other numeric range uses the generic
 * "between <minimum> and <maximum>" wording.
 */
export const NUMBER_RANGE_MESSAGE = "Please enter a number from 0 to 100";

export function numberRangeMessage(min, max) {
  if (min === 0 && max === 100) return NUMBER_RANGE_MESSAGE;
  return `Please enter a number between ${min} and ${max}`;
}

export function dropdownMessage(values) {
  return `Please select one of the following values: ${values.join(", ")}`;
}

/** Trimmed, non-empty allowed values of a dropdown rule, in their stored order. */
export function allowedValues(values) {
  const list = typeof values === "string"
    ? values.split(",")
    : Array.isArray(values)
      ? values
      : [];
  return list.map((value) => String(value).trim()).filter((value) => value !== "");
}

function ruleType(record) {
  return record?.type ?? record?.ruleType ?? null;
}

function ruleValues(record) {
  return allowedValues(record?.values ?? record?.allowedValues);
}

function coversCoordinate(rule, coordinate) {
  if (!isCellCoordinate(rule?.range?.start) || !isCellCoordinate(rule?.range?.end)) return false;
  const target = parseCellCoordinate(coordinate);
  const start = parseCellCoordinate(rule.range.start);
  const end = parseCellCoordinate(rule.range.end);
  if (!target || !start || !end) return false;
  return target.row >= Math.min(start.row, end.row)
    && target.row <= Math.max(start.row, end.row)
    && target.column >= Math.min(start.column, end.column)
    && target.column <= Math.max(start.column, end.column);
}

function asNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Whether one non-empty value would be accepted by the rule. */
export function ruleAccepts(rule, value) {
  const text = String(value);
  const type = ruleType(rule);
  if (type === "dropdown") {
    return ruleValues(rule).includes(text.trim());
  }
  if (type === "number-range" || type === "number") {
    const parsed = asNumber(text);
    if (parsed === null) return false;
    const min = asNumber(rule?.min);
    const max = asNumber(rule?.max);
    if (min !== null && parsed < min) return false;
    if (max !== null && parsed > max) return false;
    return true;
  }
  return true;
}

/** The message a refused value displays: the rule's own message when it carries one. */
export function ruleMessage(rule) {
  const type = ruleType(rule);
  if (type === "dropdown") return dropdownMessage(ruleValues(rule));
  if (typeof rule?.message === "string" && rule.message) return rule.message;
  const min = asNumber(rule?.min) ?? 0;
  const max = asNumber(rule?.max) ?? 0;
  return numberRangeMessage(min, max);
}

/**
 * Message of the first rule that refuses one of the cells the operation is about to write, or
 * `null` when every write is acceptable. Clearing a cell is always allowed; a rule only constrains
 * cells inside its own range.
 */
export function validationRejection(validations, updates) {
  if (!Array.isArray(validations)) return null;
  for (const rule of validations) {
    for (const update of updates) {
      if (update.value === "" || update.value === null || update.value === undefined) continue;
      if (!coversCoordinate(rule, update.coordinate)) continue;
      if (!ruleAccepts(rule, update.value)) return ruleMessage(rule);
    }
  }
  return null;
}

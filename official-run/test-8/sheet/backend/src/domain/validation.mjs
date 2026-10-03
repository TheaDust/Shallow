import { randomUUID } from "node:crypto";

/**
 * Data-validation rules for a worksheet.
 *
 * A rule constrains a rectangle of cells (`range`) and is enforced on every
 * write through the trusted API boundary, so grid edits, the formula bar and
 * bulk pastes all follow the same rules. Two rule types exist:
 *
 * - `numeric`: an inclusive minimum/maximum range,
 * - `dropdown`: an exact list of allowed values.
 *
 * A numeric rule may carry a `style` naming its rejection wording
 * (`between <min> and <max>` for rules saved through the editor dialog); a
 * rule without one keeps the historical `from <min> to <max>` message.
 *
 * Blank input always passes (clearing a cell is never a violation).
 */

export const NUMERIC_RULE_TYPE = "numeric";
export const DROPDOWN_RULE_TYPE = "dropdown";

const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

export const DEFAULT_NUMERIC_STYLE = "from";
const NUMERIC_STYLES = [DEFAULT_NUMERIC_STYLE, "between"];

/** Message shown when a rule payload cannot be used. */
export const INVALID_RULE_MESSAGE = "Invalid validation rule";

/** Message shown when a dropdown rule lists no allowed value. */
export const EMPTY_DROPDOWN_MESSAGE = "Enter at least one allowed value";

/**
 * Message shown when a numeric rule rejects a value.
 *
 * A rule stored without a style (for example one planted by a pre-provisioned
 * evaluation seed) keeps the historical `from <min> to <max>` wording, while a
 * rule saved through the editor's "Number range" dialog uses
 * `between <min> and <max>`.
 */
export function numericRuleMessage(min, max, style = DEFAULT_NUMERIC_STYLE) {
  if (style === "between") return `Please enter a number between ${min} and ${max}`;
  return `Please enter a number from ${min} to ${max}`;
}

/** Normalizes the optional message style stored on a numeric rule. */
export function normalizeNumericStyle(raw) {
  return typeof raw === "string" && NUMERIC_STYLES.includes(raw) ? raw : DEFAULT_NUMERIC_STYLE;
}

/** Message shown when a dropdown rule rejects a value. */
export function dropdownRuleMessage(values) {
  return `Please select one of the following values: ${values.join(", ")}`;
}

/** True for a finite number; used to keep malformed stored rules out of enforcement. */
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isRuleRange(range) {
  return (
    range !== null &&
    typeof range === "object" &&
    Number.isInteger(range.minRow) &&
    Number.isInteger(range.maxRow) &&
    Number.isInteger(range.minCol) &&
    Number.isInteger(range.maxCol) &&
    range.minRow <= range.maxRow &&
    range.minCol <= range.maxCol
  );
}

function isRule(rule) {
  if (rule === null || typeof rule !== "object") return false;
  if (!isRuleRange(rule.range)) return false;
  if (rule.type === NUMERIC_RULE_TYPE) {
    return isFiniteNumber(rule.min) && isFiniteNumber(rule.max) && rule.min <= rule.max;
  }
  if (rule.type === DROPDOWN_RULE_TYPE) {
    return Array.isArray(rule.values) && rule.values.every((value) => typeof value === "string");
  }
  return false;
}

/** Keeps only well-formed rules so a corrupt record can never break a write. */
export function normalizeValidationRules(raw) {
  return Array.isArray(raw) ? raw.filter(isRule) : [];
}

/** True when the coordinate falls inside the rule's rectangle. */
export function ruleCovers(rule, row, col) {
  return (
    row >= rule.range.minRow &&
    row <= rule.range.maxRow &&
    col >= rule.range.minCol &&
    col <= rule.range.maxCol
  );
}

/** Every rule of `validations` that constrains the given cell, in stored order. */
export function rulesForCell(validations, row, col) {
  return normalizeValidationRules(validations).filter((rule) => ruleCovers(rule, row, col));
}

/** True when the raw text is a plain number (used by numeric rules). */
export function isNumericText(text) {
  return NUMBER_PATTERN.test(text.trim());
}

/**
 * The message explaining why `raw` violates `rule`, or null when the value is
 * accepted (blank values are always accepted).
 */
export function ruleError(rule, raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") return null;
  if (rule.type === NUMERIC_RULE_TYPE) {
    const message = () => numericRuleMessage(rule.min, rule.max, normalizeNumericStyle(rule.style));
    if (!isNumericText(text)) return message();
    const value = Number(text);
    if (value < rule.min || value > rule.max) return message();
    return null;
  }
  if (rule.type === DROPDOWN_RULE_TYPE) {
    if (!rule.values.includes(text)) return dropdownRuleMessage(rule.values);
    return null;
  }
  return null;
}

/**
 * Checks a rule sent by the editor and returns the rule to store
 * (`{ok: true, rule}`) or a message explaining the rejection. The range must
 * lie inside the grid; dropdown values are trimmed and empty ones dropped.
 */
export function normalizeRulePayload(raw, worksheet) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: INVALID_RULE_MESSAGE };
  }
  const range = raw.range;
  if (
    !range ||
    typeof range !== "object" ||
    !Number.isInteger(range.minRow) ||
    !Number.isInteger(range.maxRow) ||
    !Number.isInteger(range.minCol) ||
    !Number.isInteger(range.maxCol) ||
    range.minRow < 0 ||
    range.minCol < 0 ||
    range.minRow > range.maxRow ||
    range.minCol > range.maxCol ||
    range.maxRow >= worksheet.rowCount ||
    range.maxCol >= worksheet.columnCount
  ) {
    return { ok: false, error: INVALID_RULE_MESSAGE };
  }
  const id = typeof raw.id === "string" && raw.id !== "" ? raw.id : randomUUID();
  const normalizedRange = {
    minRow: range.minRow,
    maxRow: range.maxRow,
    minCol: range.minCol,
    maxCol: range.maxCol,
  };
  if (raw.type === NUMERIC_RULE_TYPE) {
    const min = typeof raw.min === "number" ? raw.min : Number(raw.min);
    const max = typeof raw.max === "number" ? raw.max : Number(raw.max);
    if (!isFiniteNumber(min) || !isFiniteNumber(max) || min > max) {
      return { ok: false, error: INVALID_RULE_MESSAGE };
    }
    return {
      ok: true,
      rule: { id, type: NUMERIC_RULE_TYPE, min, max, range: normalizedRange, style: normalizeNumericStyle(raw.style) },
    };
  }
  if (raw.type === DROPDOWN_RULE_TYPE) {
    if (!Array.isArray(raw.values)) return { ok: false, error: INVALID_RULE_MESSAGE };
    if (!raw.values.every((value) => typeof value === "string")) {
      return { ok: false, error: INVALID_RULE_MESSAGE };
    }
    const values = raw.values.map((value) => value.trim()).filter((value) => value !== "");
    if (values.length === 0) return { ok: false, error: EMPTY_DROPDOWN_MESSAGE };
    return { ok: true, rule: { id, type: DROPDOWN_RULE_TYPE, values, range: normalizedRange } };
  }
  return { ok: false, error: INVALID_RULE_MESSAGE };
}

/**
 * Stores `rule` in place of the rule it replaces: the same id, or any rule
 * covering exactly the same rectangle (so re-saving a range never stacks
 * duplicate constraints). Returns a new list; the input is not mutated.
 */
export function saveValidationRule(worksheet, rule) {
  const sameRange = (entry) =>
    entry?.range &&
    entry.range.minRow === rule.range.minRow &&
    entry.range.maxRow === rule.range.maxRow &&
    entry.range.minCol === rule.range.minCol &&
    entry.range.maxCol === rule.range.maxCol;
  const kept = normalizeValidationRules(worksheet.validations).filter(
    (entry) => entry.id !== rule.id && !sameRange(entry),
  );
  return [...kept, rule];
}

/** Removes the rule with `id`; returns a new list, or null when it is unknown. */
export function deleteValidationRule(worksheet, id) {
  const rules = normalizeValidationRules(worksheet.validations);
  if (!rules.some((rule) => rule.id === id)) return null;
  return rules.filter((rule) => rule.id !== id);
}

/**
 * Checks a rectangular write (`values[row][col]` starting at `start`) against
 * the worksheet rules. Returns `{ok: true}` or `{ok: false, error}` with the
 * message of the first rejected cell; callers reject the whole write so no
 * target cell can be partially updated.
 */
export function validateCellWrites(worksheet, start, values) {
  const validations = normalizeValidationRules(worksheet.validations);
  if (validations.length === 0) return { ok: true };
  for (let rowOffset = 0; rowOffset < values.length; rowOffset += 1) {
    const line = values[rowOffset];
    for (let colOffset = 0; colOffset < line.length; colOffset += 1) {
      const row = start.row + rowOffset;
      const col = start.col + colOffset;
      for (const rule of rulesForCell(validations, row, col)) {
        const error = ruleError(rule, line[colOffset]);
        if (error) return { ok: false, error };
      }
    }
  }
  return { ok: true };
}

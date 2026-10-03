import type { CellRange, DropdownValidationRule, ValidationRule } from "./types";

/**
 * Frontend twin of `backend/src/domain/validation.mjs`.
 *
 * The server is the authority: it validates every write and rejects the whole
 * rectangle. This mirror lets the browser pre-check a write (and lets the test
 * double behave exactly like the API), so both runtimes must stay
 * behaviour-compatible — change one and change the other.
 */

export const NUMERIC_RULE_TYPE = "numeric";
export const DROPDOWN_RULE_TYPE = "dropdown";

/** Default wording style of a numeric rule (rules stored without one). */
export const DEFAULT_NUMERIC_STYLE = "from";

/** Message shown when a dropdown rule lists no allowed value. */
export const EMPTY_DROPDOWN_MESSAGE = "Enter at least one allowed value";

const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Message shown when a numeric rule rejects a value. A rule saved through the
 * "Number range" dialog uses the `between` wording; a rule stored without a
 * style (for example a pre-provisioned seed) keeps `from <min> to <max>`.
 */
export function numericRuleMessage(
  min: number,
  max: number,
  style: "from" | "between" = DEFAULT_NUMERIC_STYLE,
): string {
  if (style === "between") return `Please enter a number between ${min} and ${max}`;
  return `Please enter a number from ${min} to ${max}`;
}

/** Message shown when a dropdown rule rejects a value. */
export function dropdownRuleMessage(values: readonly string[]): string {
  return `Please select one of the following values: ${values.join(", ")}`;
}

export function normalizeValidationRules(raw: unknown): ValidationRule[] {
  return Array.isArray(raw) ? (raw as ValidationRule[]).filter(isRule) : [];
}

function isRule(rule: ValidationRule): boolean {
  if (!rule || typeof rule !== "object" || !isRuleRange(rule.range)) return false;
  if (rule.type === NUMERIC_RULE_TYPE) {
    return (
      Number.isFinite(rule.min) &&
      Number.isFinite(rule.max) &&
      rule.min <= rule.max
    );
  }
  if (rule.type === DROPDOWN_RULE_TYPE) {
    return Array.isArray(rule.values) && rule.values.every((value) => typeof value === "string");
  }
  return false;
}

function isRuleRange(range: CellRange): boolean {
  return (
    Boolean(range) &&
    Number.isInteger(range.minRow) &&
    Number.isInteger(range.maxRow) &&
    Number.isInteger(range.minCol) &&
    Number.isInteger(range.maxCol) &&
    range.minRow <= range.maxRow &&
    range.minCol <= range.maxCol
  );
}

/** True when the coordinate falls inside the rule's rectangle. */
export function ruleCovers(rule: ValidationRule, row: number, col: number): boolean {
  return (
    row >= rule.range.minRow &&
    row <= rule.range.maxRow &&
    col >= rule.range.minCol &&
    col <= rule.range.maxCol
  );
}

/** Every rule of `validations` that constrains the given cell, in stored order. */
export function rulesForCell(validations: unknown, row: number, col: number): ValidationRule[] {
  return normalizeValidationRules(validations).filter((rule) => ruleCovers(rule, row, col));
}

export function isNumericText(text: string): boolean {
  return NUMBER_PATTERN.test(text.trim());
}

/**
 * Allowed values of the dropdown rule constraining a cell, or null when the
 * cell has none (the grid then shows its value without a dropdown button).
 */
export function dropdownValuesForCell(
  validations: unknown,
  row: number,
  col: number,
): string[] | null {
  const rules = rulesForCell(validations, row, col).filter(
    (rule): rule is DropdownValidationRule => rule.type === DROPDOWN_RULE_TYPE,
  );
  return rules.length > 0 ? rules[rules.length - 1].values : null;
}

/**
 * The rule whose rectangle contains `bounds`, or null when the selection is
 * not constrained yet. Used to prefill the dialog when a rule is reopened.
 */
export function ruleCoveringBounds(validations: unknown, bounds: CellRange): ValidationRule | null {
  return (
    normalizeValidationRules(validations).find(
      (rule) =>
        rule.range.minRow <= bounds.minRow &&
        rule.range.maxRow >= bounds.maxRow &&
        rule.range.minCol <= bounds.minCol &&
        rule.range.maxCol >= bounds.maxCol,
    ) ?? null
  );
}

/** The message explaining why `raw` violates `rule`, or null when accepted. */
export function ruleError(rule: ValidationRule, raw: string): string | null {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") return null;
  if (rule.type === NUMERIC_RULE_TYPE) {
    const message = () => numericRuleMessage(rule.min, rule.max, rule.style ?? DEFAULT_NUMERIC_STYLE);
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

export interface WriteCheck {
  ok: boolean;
  error?: string;
}

/** Checks a rectangular write against the worksheet rules (first failure wins). */
export function validateCellWrites(
  worksheet: { validations?: ValidationRule[] },
  start: { row: number; col: number },
  values: readonly (readonly string[])[],
): WriteCheck {
  const validations = normalizeValidationRules(worksheet.validations);
  if (validations.length === 0) return { ok: true };
  for (let rowOffset = 0; rowOffset < values.length; rowOffset += 1) {
    const line = values[rowOffset];
    for (let colOffset = 0; colOffset < line.length; colOffset += 1) {
      const rules = rulesForCell(validations, start.row + rowOffset, start.col + colOffset);
      for (const rule of rules) {
        const error = ruleError(rule, line[colOffset]);
        if (error) return { ok: false, error };
      }
    }
  }
  return { ok: true };
}

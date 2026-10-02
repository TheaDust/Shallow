import {
  isCellCoordinate,
  parseCellCoordinate,
  type CellRange,
} from "./spreadsheet";

/**
 * Data-validation rules of one worksheet (REQ-5-2):
 *
 * - `{ id, type: "dropdown", range, values: ["East", "North"] }`
 * - `{ id, type: "number-range", range, min: 0, max: 100, message: "…" }`
 *
 * The server enforces every rule again when a write arrives (grid, formula bar, paste, range move);
 * this module only describes the rules for the UI and produces the same messages.
 */
export type ValidationRuleType = "dropdown" | "number-range";

export interface DropdownRule {
  id: string;
  type: "dropdown";
  range: CellRange;
  values: string[];
}

export interface NumberRangeRule {
  id: string;
  type: "number-range";
  range: CellRange;
  min: number;
  max: number;
  message: string;
}

export type ValidationRule = DropdownRule | NumberRangeRule;

/** Options of the `Rule type` combo box, in the order the dialog offers them. */
export const RULE_TYPE_OPTIONS: ReadonlyArray<{ value: ValidationRuleType; label: string }> = [
  { value: "dropdown", label: "Dropdown" },
  { value: "number-range", label: "Number range" },
];

/** Splits the `Allowed values` text box: comma separated, each item trimmed of surrounding spaces. */
export function parseAllowedValues(text: string): string[] {
  return text
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

export function dropdownMessage(values: readonly string[]): string {
  return `Please select one of the following values: ${values.join(", ")}`;
}

export function numberRangeMessage(min: number, max: number): string {
  if (min === 0 && max === 100) return "Please enter a number from 0 to 100";
  return `Please enter a number between ${min} and ${max}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validRange(value: unknown): CellRange | null {
  if (!isRecord(value)) return null;
  const { start, end } = value;
  return typeof start === "string" && typeof end === "string"
    && isCellCoordinate(start) && isCellCoordinate(end)
    ? { start, end }
    : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** The well-formed rules of a worksheet, in their stored order. */
export function parseValidationRules(validations: unknown): ValidationRule[] {
  if (!Array.isArray(validations)) return [];
  const rules: ValidationRule[] = [];
  validations.forEach((record, index) => {
    if (!isRecord(record)) return;
    const range = validRange(record.range);
    if (!range) return;
    const id = typeof record.id === "string" && record.id ? record.id : `dv-${index + 1}`;
    const type = record.type ?? record.ruleType;
    if (type === "dropdown") {
      const values = Array.isArray(record.values)
        ? record.values.map((value) => String(value).trim()).filter((value) => value !== "")
        : [];
      rules.push({ id, type: "dropdown", range, values });
      return;
    }
    if (type === "number-range" || type === "number") {
      const min = toNumber(record.min) ?? 0;
      const max = toNumber(record.max) ?? 0;
      rules.push({
        id,
        type: "number-range",
        range,
        min,
        max,
        message: typeof record.message === "string" && record.message
          ? record.message
          : numberRangeMessage(min, max),
      });
    }
  });
  return rules;
}

export function ruleCovers(rule: ValidationRule, coordinate: string): boolean {
  const target = parseCellCoordinate(coordinate);
  const start = parseCellCoordinate(rule.range.start);
  const end = parseCellCoordinate(rule.range.end);
  if (!target || !start || !end) return false;
  return target.row >= Math.min(start.row, end.row)
    && target.row <= Math.max(start.row, end.row)
    && target.column >= Math.min(start.column, end.column)
    && target.column <= Math.max(start.column, end.column);
}

/** The first rule covering a cell, whichever kind it is. */
export function ruleAt(rules: readonly ValidationRule[], coordinate: string): ValidationRule | null {
  return rules.find((rule) => ruleCovers(rule, coordinate)) ?? null;
}

/** The dropdown rule covering a cell; the grid shows its `Open dropdown for <coordinate>` button. */
export function dropdownRuleAt(rules: readonly ValidationRule[], coordinate: string): DropdownRule | null {
  return rules.find((rule): rule is DropdownRule => rule.type === "dropdown" && ruleCovers(rule, coordinate)) ?? null;
}

/** Whether a rule accepts one non-empty value, mirroring the server-side check. */
export function ruleAccepts(rule: ValidationRule, value: string): boolean {
  const text = value.trim();
  if (rule.type === "dropdown") return rule.values.includes(text);
  const parsed = Number(text);
  if (text === "" || !Number.isFinite(parsed)) return false;
  return parsed >= rule.min && parsed <= rule.max;
}

export function ruleMessage(rule: ValidationRule): string {
  return rule.type === "dropdown" ? dropdownMessage(rule.values) : rule.message;
}

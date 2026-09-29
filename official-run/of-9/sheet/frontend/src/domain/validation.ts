import type { CellRange, ValidationRule } from "./types";
import { cellCoordinate, normalizeSelection, parseCoordinate, type GridSelection } from "./grid";

/** True when the 1-based row/column lies inside a normalized range. */
export function positionInRange(range: CellRange, row: number, column: number): boolean {
  return (
    row >= range.start.row &&
    row <= range.end.row &&
    column >= range.start.column &&
    column <= range.end.column
  );
}

/** True when two normalized ranges share at least one cell. */
export function rangesOverlap(a: CellRange, b: CellRange): boolean {
  return (
    Math.max(a.start.row, b.start.row) <= Math.min(a.end.row, b.end.row) &&
    Math.max(a.start.column, b.start.column) <= Math.min(a.end.column, b.end.column)
  );
}

/** First dropdown rule covering a cell coordinate (or null). */
export function dropdownRuleAt(rules: ValidationRule[] | undefined, coordinate: string): ValidationRule | null {
  if (!rules) return null;
  const position = parseCoordinate(coordinate);
  if (!position) return null;
  for (const rule of rules) {
    if (rule.type !== "dropdown") continue;
    if (positionInRange(rule.range, position.row, position.column)) return rule;
  }
  return null;
}

/**
 * The rule to prefill when editing validation for a selection: first a rule
 * that fully contains the selection, then a rule covering its anchor cell,
 * then any intersecting rule.
 */
export function ruleForSelection(rules: ValidationRule[] | undefined, selection: GridSelection): ValidationRule | null {
  if (!rules || rules.length === 0) return null;
  const normalized = normalizeSelection(selection);
  const containing = rules.find(
    (rule) =>
      rule.range.start.row <= normalized.start.row &&
      rule.range.end.row >= normalized.end.row &&
      rule.range.start.column <= normalized.start.column &&
      rule.range.end.column >= normalized.end.column,
  );
  if (containing) return containing;
  return (
    rules.find((rule) => positionInRange(rule.range, normalized.start.row, normalized.start.column)) ??
    rules.find((rule) => rangesOverlap(rule.range, normalized)) ??
    null
  );
}

/** Splits a comma-separated list into trimmed, non-empty items. */
export function parseAllowedValues(text: string): string[] {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/** Header texts of a range (values of its first row), one per column. */
export function rangeHeaders(cells: Record<string, { value: string }>, range: CellRange): string[] {
  const headers: string[] = [];
  for (let column = range.start.column; column <= range.end.column; column += 1) {
    headers.push(cells[cellCoordinate(range.start.row, column)]?.value ?? "");
  }
  return headers;
}

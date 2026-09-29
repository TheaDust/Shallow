import type { CellRange, ColumnFilter, FilterConditionName, FilterView } from "./types";
import { cellCoordinate } from "./grid";

export const FILTER_CONDITION_OPTIONS: ReadonlyArray<{ value: FilterConditionName; label: string }> = [
  { value: "text-contains", label: "Text contains" },
  { value: "greater-than", label: "Greater than" },
  { value: "before", label: "Before" },
  { value: "is-empty", label: "Is empty" },
  { value: "is-not-empty", label: "Is not empty" },
];

export function conditionLabel(condition: FilterConditionName): string {
  return FILTER_CONDITION_OPTIONS.find((option) => option.value === condition)?.label ?? condition;
}

/** Parses a displayed value as a plain number; null when it is not numeric. */
export function parseNumeric(text: string): number | null {
  const trimmed = String(text).trim();
  if (trimmed === "") return null;
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function parseDate(text: string): number | null {
  const trimmed = String(text).trim();
  if (trimmed === "") return null;
  const value = Date.parse(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * Decides whether one displayed cell value satisfies a condition filter.
 * "Text contains" is case-insensitive; "Greater than"/"Before" compare by
 * type (number/date) when both sides parse, otherwise lexicographically.
 */
export function conditionMatches(value: string, condition: FilterConditionName, filterValue: string): boolean {
  switch (condition) {
    case "is-empty":
      return value === "";
    case "is-not-empty":
      return value !== "";
    case "text-contains":
      return String(value).toLowerCase().includes(String(filterValue).toLowerCase());
    case "greater-than": {
      const left = parseNumeric(value);
      const right = parseNumeric(filterValue);
      if (left !== null && right !== null) return left > right;
      return String(value).localeCompare(String(filterValue)) > 0;
    }
    case "before": {
      const left = parseDate(value);
      const right = parseDate(filterValue);
      if (left !== null && right !== null) return left < right;
      return String(value).localeCompare(String(filterValue)) < 0;
    }
    default:
      return true;
  }
}

/** Decides whether a displayed value passes one column filter. */
export function columnFilterMatches(value: string, filter: ColumnFilter): boolean {
  if (filter.mode === "values") {
    return (filter.values ?? []).includes(value);
  }
  if (!filter.condition) return true;
  return conditionMatches(value, filter.condition, filter.value ?? "");
}

/** Distinct non-header source values of one column, in order of first appearance. */
export function distinctValues(cells: Record<string, { value: string }>, range: CellRange, column: number): string[] {
  const seen: string[] = [];
  for (let row = range.start.row + 1; row <= range.end.row; row += 1) {
    const value = cells[cellCoordinate(row, column)]?.value ?? "";
    if (!seen.includes(value)) seen.push(value);
  }
  return seen;
}

/**
 * Rows of the worksheet that must stay hidden while the filter view is
 * active. Only data rows inside the filter range are evaluated; the header row
 * and every row outside the range stay visible. Conditions on different
 * columns are combined with AND.
 */
export function buildHiddenRows(cells: Record<string, { value: string }>, view: FilterView): Set<number> {
  const hidden = new Set<number>();
  if (!view?.range?.start || !view?.range?.end) return hidden;
  const conditions = view.conditions ?? [];
  if (conditions.length === 0) return hidden;
  const columnFilters = new Map<number, ColumnFilter>();
  for (const condition of conditions) columnFilters.set(condition.column, condition);
  for (let row = view.range.start.row + 1; row <= view.range.end.row; row += 1) {
    let matches = true;
    for (const [column, filter] of columnFilters) {
      const value = cells[cellCoordinate(row, column)]?.value ?? "";
      if (!columnFilterMatches(value, filter)) {
        matches = false;
        break;
      }
    }
    if (!matches) hidden.add(row);
  }
  return hidden;
}

/** Formats a cell range as "A1:C6". */
export function formatCellRange(range: CellRange): string {
  return `${cellCoordinate(range.start.row, range.start.column)}:${cellCoordinate(range.end.row, range.end.column)}`;
}

/** Finds the stored filter for one column (or null). */
export function columnFilterFor(view: FilterView | null, column: number): ColumnFilter | null {
  if (!view) return null;
  return view.conditions?.find((condition) => condition.column === column) ?? null;
}

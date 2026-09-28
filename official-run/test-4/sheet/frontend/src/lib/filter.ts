import { cellName, columnName, parseCoord, type CellRange } from "./spreadsheet";

/** Per-column filter state (REQ-5-1-2). */
export type ColumnFilter =
  | { kind: "values"; selected: string[] }
  | { kind: "condition"; condition: string; value: string };

/** Persisted filter view for a worksheet: rectangle + per-column filters. */
export interface SheetFilter {
  start: string;
  end: string;
  columns: Record<string, ColumnFilter>;
}

/** The five condition options required by REQ-5-1-2. */
export const CONDITION_OPTIONS = [
  "Text contains",
  "Greater than",
  "Before",
  "Is empty",
  "Is not empty",
] as const;

/** Conditions that use the "Value" text box. */
export const CONDITION_USES_VALUE = new Set<string>(["Text contains", "Greater than", "Before"]);

/** The displayed value of a cell: calculated result for formulas, raw text otherwise. */
export function displayValue(
  cells: Record<string, string>,
  results: Record<string, string>,
  coord: string,
): string {
  return results[coord] ?? cells[coord] ?? "";
}

/**
 * Distinct non-empty source values of a column inside the filter rectangle,
 * excluding the header row, in order of first appearance. Empty cells are not
 * offered as checkbox values (filtering by specific values hides blank rows).
 */
export function distinctValues(
  cells: Record<string, string>,
  results: Record<string, string>,
  range: CellRange,
  columnLetter: string,
): string[] {
  const from = parseCoord(range.start);
  const to = parseCoord(range.end);
  const columnIndex = parseCoord(`${columnLetter}1`)?.col ?? -1;
  if (!from || !to || columnIndex < 0) return [];
  const rowMin = Math.min(from.row, to.row);
  const rowMax = Math.max(from.row, to.row);
  const values: string[] = [];
  const seen = new Set<string>();
  for (let row = rowMin + 1; row <= rowMax; row += 1) {
    const value = displayValue(cells, results, cellName(row, columnIndex));
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

/**
 * Parse a loose date text (ISO, slashed, or dotted) into a UTC timestamp;
 * falls back to the platform date parser. Returns null when unparseable.
 */
export function parseDate(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (iso) {
    return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }
  const dotted = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(trimmed);
  if (dotted) {
    return Date.UTC(Number(dotted[1]), Number(dotted[2]) - 1, Number(dotted[3]));
  }
  const american = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(trimmed);
  if (american) {
    return Date.UTC(Number(american[3]), Number(american[1]) - 1, Number(american[2]));
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Whether a cell value passes a single column filter. */
export function matchesColumnFilter(value: string, filter: ColumnFilter): boolean {
  if (filter.kind === "values") {
    return filter.selected.includes(value);
  }
  switch (filter.condition) {
    case "Text contains":
      return value.toLowerCase().includes(filter.value.toLowerCase());
    case "Greater than": {
      const actual = Number(value);
      const threshold = Number(filter.value);
      return (
        value.trim() !== "" &&
        filter.value.trim() !== "" &&
        Number.isFinite(actual) &&
        Number.isFinite(threshold) &&
        actual > threshold
      );
    }
    case "Before": {
      const actual = parseDate(value);
      const threshold = parseDate(filter.value);
      return actual !== null && threshold !== null && actual < threshold;
    }
    case "Is empty":
      return value === "";
    case "Is not empty":
      return value !== "";
    default:
      return true;
  }
}

/**
 * Whether a grid row stays visible under the worksheet filter. The filter
 * header row and every row outside the filter rectangle are always visible;
 * nonmatching rows inside the rectangle are hidden only (never deleted or
 * reordered). Conditions on different columns are combined with AND.
 */
export function rowMatchesFilter(
  cells: Record<string, string>,
  results: Record<string, string>,
  filter: SheetFilter | null | undefined,
  row: number,
): boolean {
  if (!filter) return true;
  const from = parseCoord(filter.start);
  const to = parseCoord(filter.end);
  if (!from || !to) return true;
  const rowMin = Math.min(from.row, to.row);
  const rowMax = Math.max(from.row, to.row);
  if (row <= rowMin || row > rowMax) return true;
  const colMin = Math.min(from.col, to.col);
  const colMax = Math.max(from.col, to.col);
  for (let col = colMin; col <= colMax; col += 1) {
    const columnFilter = filter.columns[columnName(col)];
    if (!columnFilter) continue;
    const value = displayValue(cells, results, cellName(row, col));
    if (!matchesColumnFilter(value, columnFilter)) return false;
  }
  return true;
}

/** The header row of a filter rectangle (top-left row). */
export function filterHeaderRow(filter: SheetFilter | null | undefined): number | null {
  if (!filter) return null;
  const from = parseCoord(filter.start);
  const to = parseCoord(filter.end);
  if (!from || !to) return null;
  return Math.min(from.row, to.row);
}

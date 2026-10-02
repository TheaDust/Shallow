import {
  cellCoordinate,
  columnIndex,
  columnLabel,
  isCellCoordinate,
  parseCellCoordinate,
  type CellRange,
  type NormalizedRange,
} from "./spreadsheet";

/**
 * Filter view of one worksheet (REQ-5-1-2). A filter hides rows and nothing else: the records stay
 * in place, in their original order, and every view that reads the cells (grid export, pivot
 * sources, this module's own values) still sees them.
 *
 * A filter view holds the region (its first row is the header row) plus one condition per filtered
 * column:
 *
 * - `{ column: "A", kind: "values", values: ["East"] }` — the checked values of the column,
 * - `{ column: "B", kind: "condition", operator: "greater-than", value: "900" }`.
 *
 * Conditions of different columns are combined with AND.
 */
export const FILTER_OPERATORS = ["text-contains", "greater-than", "before", "is-empty", "is-not-empty"] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number];

/** Visible names of the `Condition` combo box options, in the order the dialog offers them. */
export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  "text-contains": "Text contains",
  "greater-than": "Greater than",
  before: "Before",
  "is-empty": "Is empty",
  "is-not-empty": "Is not empty",
};

export interface ValuesCondition {
  column: string;
  kind: "values";
  values: string[];
}

export interface OperatorCondition {
  column: string;
  kind: "condition";
  operator: FilterOperator;
  value: string;
}

export type ColumnCondition = ValuesCondition | OperatorCondition;

export interface FilterView {
  id: string;
  range: CellRange;
  conditions: ColumnCondition[];
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

function parseCondition(value: unknown): ColumnCondition | null {
  if (!isRecord(value)) return null;
  const column = typeof value.column === "string" ? value.column.toUpperCase() : "";
  if (!/^[A-Z]+$/.test(column)) return null;
  if (value.kind === "values") {
    const values = Array.isArray(value.values) ? value.values.map((item) => String(item)) : [];
    return { column, kind: "values", values };
  }
  if (value.kind === "condition" && FILTER_OPERATORS.includes(value.operator as FilterOperator)) {
    return {
      column,
      kind: "condition",
      operator: value.operator as FilterOperator,
      value: typeof value.value === "string" ? value.value : "",
    };
  }
  return null;
}

/** The filter view of a worksheet, or `null` when nothing is filtered. */
export function activeFilter(filters: unknown): FilterView | null {
  if (!Array.isArray(filters)) return null;
  for (const record of filters) {
    const range = isRecord(record) ? validRange(record.range) : null;
    if (!range) continue;
    const conditions: ColumnCondition[] = [];
    if (Array.isArray(record.conditions)) {
      for (const item of record.conditions) {
        const parsed = parseCondition(item as unknown);
        if (parsed) conditions.push(parsed);
      }
    }
    return {
      id: typeof record.id === "string" && record.id ? record.id : "filter-1",
      range,
      conditions,
    };
  }
  return null;
}

export function filterBounds(filter: FilterView): NormalizedRange {
  const start = parseCellCoordinate(filter.range.start) ?? { row: 0, column: 0 };
  const end = parseCellCoordinate(filter.range.end) ?? start;
  return {
    minRow: Math.min(start.row, end.row),
    maxRow: Math.max(start.row, end.row),
    minColumn: Math.min(start.column, end.column),
    maxColumn: Math.max(start.column, end.column),
  };
}

/** Column letter of every column the filter view covers, in grid order. */
export function filterColumns(filter: FilterView): string[] {
  const bounds = filterBounds(filter);
  const columns: string[] = [];
  for (let column = bounds.minColumn; column <= bounds.maxColumn; column += 1) {
    columns.push(columnLabel(column));
  }
  return columns;
}

/** Header text of one column of the filter region: the value of the region's first row. */
export function filterHeaderText(filter: FilterView, cells: Record<string, string>, column: string): string {
  const bounds = filterBounds(filter);
  const index = columnIndex(column);
  if (index < 0) return "";
  return (cells[cellCoordinate(bounds.minRow, index)] ?? "").trim();
}

export function columnCondition(filter: FilterView | null, column: string): ColumnCondition | null {
  if (!filter) return null;
  return filter.conditions.find((condition) => condition.column === column.toUpperCase()) ?? null;
}

/** Distinct source values of one column of the filter region, in the order the rows show them. */
export function distinctColumnValues(
  filter: FilterView | null,
  cells: Record<string, string>,
  column: string,
): string[] {
  if (!filter) return [];
  const bounds = filterBounds(filter);
  const index = columnIndex(column);
  if (index < 0) return [];
  const seen = new Set<string>();
  const values: string[] = [];
  for (let row = bounds.minRow + 1; row <= bounds.maxRow; row += 1) {
    const value = (cells[cellCoordinate(row, index)] ?? "").trim();
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

function parseNumber(value: string): number | null {
  const text = value.trim();
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value: string): number | null {
  const text = value.trim();
  if (text === "") return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Whether one cell text satisfies a column condition. */
export function conditionMatches(condition: ColumnCondition, text: string): boolean {
  const trimmed = text.trim();
  if (condition.kind === "values") {
    return condition.values.some((value) => value.trim() === trimmed);
  }
  switch (condition.operator) {
    case "text-contains":
      return trimmed.toLowerCase().includes(condition.value.trim().toLowerCase());
    case "greater-than": {
      const cell = parseNumber(trimmed);
      const bound = parseNumber(condition.value);
      return cell !== null && bound !== null && cell > bound;
    }
    case "before": {
      const cell = parseDate(trimmed);
      const bound = parseDate(condition.value);
      return cell !== null && bound !== null && cell < bound;
    }
    case "is-empty":
      return trimmed === "";
    case "is-not-empty":
      return trimmed !== "";
    default:
      return true;
  }
}

/**
 * 0-based indexes of the rows the filter hides: a data row of the region is hidden when any column
 * condition refuses it (AND across columns). The header row is never hidden and the rows keep their
 * order - hiding never deletes nor reorders a record.
 */
export function hiddenRowIndexes(filter: FilterView | null, cells: Record<string, string>): Set<number> {
  const hidden = new Set<number>();
  if (!filter || !filter.conditions.length) return hidden;
  const bounds = filterBounds(filter);
  for (let row = bounds.minRow + 1; row <= bounds.maxRow; row += 1) {
    for (const condition of filter.conditions) {
      const index = columnIndex(condition.column);
      if (index < 0) continue;
      if (!conditionMatches(condition, cells[cellCoordinate(row, index)] ?? "")) {
        hidden.add(row);
        break;
      }
    }
  }
  return hidden;
}

/**
 * Contiguous block of non-empty cells around `anchor`, used by `Create filter` when the user has
 * not selected a region: the block's first row is the header row.
 */
export function detectDataRegion(cells: Record<string, string>, anchor: string): CellRange {
  const position = parseCellCoordinate(anchor) ?? { row: 0, column: 0 };
  const has = (row: number, column: number) => (cells[cellCoordinate(row, column)] ?? "") !== "";
  const within = (row: number, column: number) => row >= 0 && column >= 0 && row < 1000 && column < 1000;

  let minColumn = position.column;
  while (within(position.row, minColumn - 1) && has(position.row, minColumn - 1)) minColumn -= 1;
  let maxColumn = position.column;
  while (within(position.row, maxColumn + 1) && has(position.row, maxColumn + 1)) maxColumn += 1;

  const rowHasData = (row: number) => {
    if (row < 0) return false;
    for (let column = minColumn; column <= maxColumn; column += 1) {
      if (has(row, column)) return true;
    }
    return false;
  };

  let minRow = position.row;
  while (minRow > 0 && rowHasData(minRow - 1)) minRow -= 1;
  let maxRow = position.row;
  while (maxRow < 999 && rowHasData(maxRow + 1)) maxRow += 1;

  return { start: cellCoordinate(minRow, minColumn), end: cellCoordinate(maxRow, maxColumn) };
}

import { isInRegion, makeCellId, type CellAddress, type CellRegion } from "../lib/cells";
import { displayedCellText } from "../workbooks/cells";
import type { ColumnFilterData, FilterCondition, WorksheetData, WorksheetFilterData } from "../workbooks/types";

/**
 * Pure logic of the filter view: which values a column offers, whether a cell passes one column
 * filter and which rows of the worksheet are hidden. Hidden rows are only hidden — their cells keep
 * their coordinates and values, so exports and pivot summaries still read every record.
 */

export const FILTER_CONDITION_OPTIONS: readonly { id: FilterCondition; label: string }[] = [
  { id: "textContains", label: "Text contains" },
  { id: "greaterThan", label: "Greater than" },
  { id: "before", label: "Before" },
  { id: "isEmpty", label: "Is empty" },
  { id: "isNotEmpty", label: "Is not empty" },
];

/** Conditions comparing the cell text against the `Value` box; the empty conditions need no value. */
export function conditionNeedsValue(condition: FilterCondition): boolean {
  return condition !== "isEmpty" && condition !== "isNotEmpty";
}

export function conditionLabel(condition: FilterCondition): string {
  return FILTER_CONDITION_OPTIONS.find((option) => option.id === condition)?.label ?? condition;
}

/** Distinct displayed values of the data rows of one filtered column, in order of first appearance. */
export function distinctColumnValues(
  worksheet: WorksheetData,
  region: CellRegion,
  column: number,
): string[] {
  const values: string[] = [];
  for (let row = region.top + 1; row <= region.bottom; row += 1) {
    const text = displayedCellText(worksheet, makeCellId(row, column));
    if (text === "" || values.includes(text)) continue;
    values.push(text);
  }
  return values;
}

function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

const DATE_LIKE = /^\d{4}-\d{1,2}-\d{1,2}([T ][\d:.]+)?$/;

function parseDate(text: string): number | null {
  const trimmed = text.trim();
  if (!DATE_LIKE.test(trimmed)) return null;
  const value = Date.parse(trimmed);
  return Number.isNaN(value) ? null : value;
}

/** Compares two cell texts by type: numbers first, then dates; unparseable text never matches. */
function compareOrdered(left: string, right: string): number | null {
  const leftNumber = parseNumber(left);
  const rightNumber = parseNumber(right);
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  const leftDate = parseDate(left);
  const rightDate = parseDate(right);
  if (leftDate !== null && rightDate !== null) return leftDate - rightDate;
  return null;
}

/** True when the displayed cell text passes one column filter. */
export function matchesColumnFilter(value: string, columnFilter: ColumnFilterData): boolean {
  if (columnFilter.kind === "values") return columnFilter.selected.includes(value);
  switch (columnFilter.condition) {
    case "textContains":
      return value.toLowerCase().includes(columnFilter.value.toLowerCase());
    case "greaterThan": {
      const order = compareOrdered(value, columnFilter.value);
      return order !== null && order > 0;
    }
    case "before": {
      const order = compareOrdered(value, columnFilter.value);
      return order !== null && order < 0;
    }
    case "isEmpty":
      return value.trim() === "";
    case "isNotEmpty":
      return value.trim() !== "";
    default:
      return true;
  }
}

/** Rows of the filtered region hidden by the filter; the header row and rows outside stay visible. */
export function hiddenRowsOf(worksheet: WorksheetData, filter?: WorksheetFilterData | null): Set<number> {
  const hidden = new Set<number>();
  if (!filter || filter.columns.length === 0) return hidden;
  for (let row = filter.region.top + 1; row <= filter.region.bottom; row += 1) {
    for (const columnFilter of filter.columns) {
      const value = displayedCellText(worksheet, makeCellId(row, columnFilter.column));
      if (matchesColumnFilter(value, columnFilter)) continue;
      hidden.add(row);
      break;
    }
  }
  return hidden;
}

/** The filter of one column of the filter view, when the column has one. */
export function columnFilterOf(
  filter: WorksheetFilterData | null | undefined,
  column: number,
): ColumnFilterData | null {
  return filter?.columns.find((entry) => entry.column === column) ?? null;
}

/** Replaces (or removes) the filter of one column; the other columns and the region stay. */
export function withColumnFilter(
  filter: WorksheetFilterData,
  next: ColumnFilterData | null,
): ColumnFilterData[] {
  const kept = filter.columns.filter((entry) => entry.column !== (next?.column ?? -1));
  return next ? [...kept, next].sort((left, right) => left.column - right.column) : kept;
}

/** Header text of one filtered column: the displayed value of the header row cell. */
export function filterHeaderText(worksheet: WorksheetData, filter: WorksheetFilterData, column: number): string {
  return displayedCellText(worksheet, makeCellId(filter.region.top, column));
}

/**
 * The contiguous block of non-empty cells around `address`, used when a filter is created without a
 * selected rectangle. Returns null when the address itself is empty.
 */
export function dataBlockAt(worksheet: WorksheetData, address: CellAddress): CellRegion | null {
  const isFilled = (row: number, column: number) =>
    row >= 1 &&
    column >= 1 &&
    row <= worksheet.rowCount &&
    column <= worksheet.columnCount &&
    displayedCellText(worksheet, makeCellId(row, column)) !== "";
  if (!isFilled(address.row, address.column)) return null;

  const pending: CellAddress[] = [address];
  const visited = new Set<string>([makeCellId(address.row, address.column)]);
  const region: CellRegion = {
    top: address.row,
    bottom: address.row,
    left: address.column,
    right: address.column,
  };
  while (pending.length > 0) {
    const current = pending.pop() as CellAddress;
    for (const neighbour of [
      { row: current.row - 1, column: current.column },
      { row: current.row + 1, column: current.column },
      { row: current.row, column: current.column - 1 },
      { row: current.row, column: current.column + 1 },
    ]) {
      const id = makeCellId(neighbour.row, neighbour.column);
      if (visited.has(id) || !isFilled(neighbour.row, neighbour.column)) continue;
      visited.add(id);
      pending.push(neighbour);
      region.top = Math.min(region.top, neighbour.row);
      region.bottom = Math.max(region.bottom, neighbour.row);
      region.left = Math.min(region.left, neighbour.column);
      region.right = Math.max(region.right, neighbour.column);
    }
  }
  return region;
}

/** Validation rules covering a cell, used to pick the rule a dialog reopens. */
export function rulesCovering<T extends { range: CellRegion }>(rules: readonly T[] | undefined, address: CellAddress): T[] {
  return (rules ?? []).filter((rule) => isInRegion(rule.range, address));
}

/** True when `region` is exactly the rule range of a stored validation rule. */
export function sameRegion(left: CellRegion, right: CellRegion): boolean {
  return (
    left.top === right.top && left.bottom === right.bottom && left.left === right.left && left.right === right.right
  );
}

/** Coordinates of every cell a dropdown rule covers, as `A1` style ids. */
export function dropdownCellIds(worksheet: WorksheetData): Set<string> {
  const ids = new Set<string>();
  for (const rule of worksheet.validations ?? []) {
    if (rule.type !== "dropdown") continue;
    for (let row = rule.range.top; row <= rule.range.bottom; row += 1) {
      for (let column = rule.range.left; column <= rule.range.right; column += 1) ids.add(makeCellId(row, column));
    }
  }
  return ids;
}

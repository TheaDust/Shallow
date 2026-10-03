import { evaluateCells } from "./formula";
import { cellCoordinate, selectionBounds } from "./grid";
import type {
  CellRange,
  CellSelection,
  FilterColumn,
  FilterConditionOperator,
  Worksheet,
  WorksheetFilter,
} from "./types";

/**
 * Row filtering for one worksheet.
 *
 * The stored filter only describes the region and its column conditions; which
 * rows stay visible is derived here from the same raw cells the grid renders,
 * so hidden records keep their values, their order and their place in every
 * other view (CSV export and pivot sources read the worksheet, not this view).
 */

/** Named conditions shown by the filter dialog, in their dialog order. */
export const CONDITION_OPTIONS: ReadonlyArray<{ value: FilterConditionOperator; label: string }> = [
  { value: "contains", label: "Text contains" },
  { value: "greaterThan", label: "Greater than" },
  { value: "before", label: "Before" },
  { value: "isEmpty", label: "Is empty" },
  { value: "isNotEmpty", label: "Is not empty" },
];

function cellText(cells: Record<string, string>, row: number, col: number): string {
  return cells[cellCoordinate(row, col)] ?? "";
}

function hasContent(cells: Record<string, string>, row: number, col: number): boolean {
  return cellText(cells, row, col).trim() !== "";
}

function rowHasContent(
  cells: Record<string, string>,
  row: number,
  minCol: number,
  maxCol: number,
): boolean {
  for (let col = minCol; col <= maxCol; col += 1) {
    if (hasContent(cells, row, col)) return true;
  }
  return false;
}

function columnHasContent(
  cells: Record<string, string>,
  col: number,
  minRow: number,
  maxRow: number,
): boolean {
  for (let row = minRow; row <= maxRow; row += 1) {
    if (hasContent(cells, row, col)) return true;
  }
  return false;
}

/** The contiguous block of non-empty cells around `cell`, bounded by blanks. */
function dataBlock(worksheet: Worksheet, row: number, col: number): CellRange {
  const cells = worksheet.cells;
  let minRow = row;
  let maxRow = row;
  let minCol = col;
  let maxCol = col;
  if (!hasContent(cells, row, col)) return { minRow, maxRow, minCol, maxCol };
  while (minRow > 0 && rowHasContent(cells, minRow - 1, minCol, maxCol)) minRow -= 1;
  while (maxRow < worksheet.rowCount - 1 && rowHasContent(cells, maxRow + 1, minCol, maxCol)) maxRow += 1;
  while (minCol > 0 && columnHasContent(cells, minCol - 1, minRow, maxRow)) minCol -= 1;
  while (maxCol < worksheet.columnCount - 1 && columnHasContent(cells, maxCol + 1, minRow, maxRow)) {
    maxCol += 1;
  }
  return { minRow, maxRow, minCol, maxCol };
}

/**
 * Region a new filter covers: the selected rectangle, or — when only one cell
 * is selected — the contiguous data block around it, so a filter never expands
 * across a blank row or column into unrelated data.
 */
export function createFilterForSelection(worksheet: Worksheet, selection: CellSelection): WorksheetFilter {
  const bounds = selectionBounds(selection);
  const single = bounds.minRow === bounds.maxRow && bounds.minCol === bounds.maxCol;
  const range = single ? dataBlock(worksheet, bounds.minRow, bounds.minCol) : bounds;
  return { range, columns: [] };
}

/** Header text of a filtered column (falls back to the column letter). */
export function filterHeaderText(worksheet: Worksheet, filter: WorksheetFilter, col: number): string {
  const display = evaluateCells(worksheet.cells);
  const text = display[cellCoordinate(filter.range.minRow, col)] ?? "";
  if (text.trim() !== "") return text;
  let label = "";
  let remaining = col;
  do {
    label = String.fromCharCode(65 + (remaining % 26)) + label;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return label;
}

function compareValues(a: string, b: string): number {
  const numberA = a.trim() === "" ? Number.NaN : Number(a);
  const numberB = b.trim() === "" ? Number.NaN : Number(b);
  const numericA = Number.isFinite(numberA);
  const numericB = Number.isFinite(numberB);
  if (numericA && numericB) return numberA - numberB;
  if (numericA !== numericB) return numericA ? -1 : 1;
  return a.localeCompare(b);
}

/** Distinct non-empty source values of a filtered column, in display order. */
export function distinctFilterValues(worksheet: Worksheet, filter: WorksheetFilter, col: number): string[] {
  const display = evaluateCells(worksheet.cells);
  const seen = new Set<string>();
  for (let row = filter.range.minRow + 1; row <= filter.range.maxRow; row += 1) {
    const text = display[cellCoordinate(row, col)] ?? "";
    if (text !== "") seen.add(text);
  }
  return [...seen].sort(compareValues);
}

/** The stored filter entry of a column, or null when it is unconstrained. */
export function columnFilterOf(filter: WorksheetFilter, col: number): FilterColumn | null {
  return filter.columns.find((column) => column.col === col) ?? null;
}

/** Replaces (or removes, with `null`) the filter entry of one column. */
export function withColumnFilter(
  filter: WorksheetFilter,
  col: number,
  column: FilterColumn | null,
): WorksheetFilter {
  const columns = filter.columns.filter((entry) => entry.col !== col);
  if (column) columns.push(column);
  columns.sort((a, b) => a.col - b.col);
  return { ...filter, columns };
}

/** True when the displayed value of a record satisfies one column condition. */
function columnMatches(column: FilterColumn, text: string): boolean {
  if (column.kind === "values") return column.values.includes(text);
  const value = column.value;
  switch (column.operator) {
    case "contains":
      return value.trim() === "" || text.toLowerCase().includes(value.trim().toLowerCase());
    case "greaterThan": {
      const cell = text.trim() === "" ? Number.NaN : Number(text);
      const limit = value.trim() === "" ? Number.NaN : Number(value);
      return Number.isFinite(cell) && Number.isFinite(limit) && cell > limit;
    }
    case "before": {
      const cell = Date.parse(text);
      const limit = Date.parse(value.trim());
      return Number.isFinite(cell) && Number.isFinite(limit) && cell < limit;
    }
    case "isEmpty":
      return text.trim() === "";
    case "isNotEmpty":
      return text.trim() !== "";
    default:
      return true;
  }
}

/**
 * Moves a filter with the rows/columns it covers (row/column structure
 * commands). A column filter whose column is deleted is dropped, as is a
 * filter pushed outside the grid.
 */
export function remapFilterForChange(
  filter: WorksheetFilter | null | undefined,
  change: { axis: "row" | "column"; mode: "insert" | "delete"; index: number },
  rowCount: number,
  columnCount: number,
): WorksheetFilter | null {
  if (!filter || !filter.range) return null;
  const mapStart = (value: number) =>
    change.mode === "insert"
      ? value >= change.index
        ? value + 1
        : value
      : value <= change.index
        ? value
        : value - 1;
  const mapEnd = (value: number) =>
    change.mode === "insert"
      ? value >= change.index
        ? value + 1
        : value
      : value < change.index
        ? value
        : value - 1;
  const range = filter.range;
  const next = {
    minRow: change.axis === "row" ? mapStart(range.minRow) : range.minRow,
    maxRow: change.axis === "row" ? mapEnd(range.maxRow) : range.maxRow,
    minCol: change.axis === "column" ? mapStart(range.minCol) : range.minCol,
    maxCol: change.axis === "column" ? mapEnd(range.maxCol) : range.maxCol,
  };
  if (
    next.minRow > next.maxRow ||
    next.minCol > next.maxCol ||
    next.minRow < 0 ||
    next.minCol < 0 ||
    next.maxRow >= rowCount ||
    next.maxCol >= columnCount
  ) {
    return null;
  }
  const columns = filter.columns.flatMap((column) => {
    let col = column.col;
    if (change.axis === "column") {
      if (change.mode === "delete") {
        if (col === change.index) return [];
        if (col > change.index) col -= 1;
      } else if (col >= change.index) {
        col += 1;
      }
    }
    if (col < next.minCol || col > next.maxCol) return [];
    return [{ ...column, col }];
  });
  return { range: next, columns };
}

/**
 * Rows hidden by a filter: the records of the filtered region that fail at
 * least one column condition (conditions on different columns combine with
 * AND). Rows outside the region and the header row are never hidden.
 */
export function hiddenRowsForFilter(worksheet: Worksheet, filter: WorksheetFilter | null | undefined): Set<number> {
  const hidden = new Set<number>();
  if (!filter || filter.columns.length === 0) return hidden;
  const display = evaluateCells(worksheet.cells);
  for (let row = filter.range.minRow + 1; row <= filter.range.maxRow; row += 1) {
    const matches = filter.columns.every((column) =>
      columnMatches(column, display[cellCoordinate(row, column.col)] ?? ""),
    );
    if (!matches) hidden.add(row);
  }
  return hidden;
}

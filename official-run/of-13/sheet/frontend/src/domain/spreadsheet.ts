/** Grid geometry and cell-coordinate helpers, independent of React. */

export const SHEET_COLUMN_COUNT = 26;
export const SHEET_ROW_COUNT = 50;

export interface CellSelection {
  /** Anchor or single cell of the selected rectangular region. */
  start: string;
  /** Opposite corner of the selected rectangular region. */
  end: string;
}

export interface CellPosition {
  /** Zero-based row index. */
  row: number;
  /** Zero-based column index. */
  column: number;
}

export function columnName(column: number): string {
  let value = column + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

export function cellAddress(row: number, column: number): string {
  return `${columnName(column)}${row + 1}`;
}

export function parseAddress(address: string): CellPosition | null {
  const match = /^([A-Za-z]+)([1-9]\d*)$/.exec(address.trim());
  if (!match) return null;
  const letters = match[1].toUpperCase();
  let column = 0;
  for (const letter of letters) {
    column = column * 26 + (letter.charCodeAt(0) - 64);
  }
  return { row: Number(match[2]) - 1, column: column - 1 };
}

/** Grid size; worksheets may store a larger one after rows/columns were inserted. */
export interface GridSize {
  rows: number;
  columns: number;
}

export const DEFAULT_GRID_SIZE: GridSize = { rows: SHEET_ROW_COUNT, columns: SHEET_COLUMN_COUNT };

export function isInsideGrid(position: CellPosition, size: GridSize = DEFAULT_GRID_SIZE): boolean {
  return (
    position.row >= 0 &&
    position.row < size.rows &&
    position.column >= 0 &&
    position.column < size.columns
  );
}

export function clampAddress(address: string, size: GridSize = DEFAULT_GRID_SIZE): string {
  const position = parseAddress(address);
  if (!position) return cellAddress(0, 0);
  return cellAddress(
    Math.min(Math.max(position.row, 0), size.rows - 1),
    Math.min(Math.max(position.column, 0), size.columns - 1),
  );
}

export interface SelectionBounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function selectionBounds(selection: CellSelection): SelectionBounds {
  const start = parseAddress(selection.start) ?? { row: 0, column: 0 };
  const end = parseAddress(selection.end) ?? start;
  return {
    top: Math.min(start.row, end.row),
    bottom: Math.max(start.row, end.row),
    left: Math.min(start.column, end.column),
    right: Math.max(start.column, end.column),
  };
}

export function isCellSelected(address: string, selection: CellSelection): boolean {
  const position = parseAddress(address);
  if (!position) return false;
  const bounds = selectionBounds(selection);
  return (
    position.row >= bounds.top &&
    position.row <= bounds.bottom &&
    position.column >= bounds.left &&
    position.column <= bounds.right
  );
}

export function shiftAddress(
  address: string,
  rowDelta: number,
  columnDelta: number,
  size: GridSize = DEFAULT_GRID_SIZE,
): string {
  const position = parseAddress(address) ?? { row: 0, column: 0 };
  return clampAddress(cellAddress(position.row + rowDelta, position.column + columnDelta), size);
}

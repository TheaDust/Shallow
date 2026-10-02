export const DEFAULT_ROW_COUNT = 30;
export const DEFAULT_COLUMN_COUNT = 26;

export interface CellPosition {
  row: number;
  column: number;
}

export interface SelectionRange {
  anchor: string;
  focus: string;
}

/** A rectangle named by two opposite corners, in any corner order. */
export interface CellRange {
  start: string;
  end: string;
}

export interface NormalizedRange {
  minRow: number;
  maxRow: number;
  minColumn: number;
  maxColumn: number;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function columnLabel(index: number): string {
  let remaining = index;
  let label = "";
  do {
    label = LETTERS[remaining % 26] + label;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return label;
}

export function columnIndex(label: string): number {
  let index = 0;
  for (const letter of label) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

export function isCellCoordinate(value: string): boolean {
  return /^[A-Z]+[1-9][0-9]*$/.test(value);
}

export function parseCellCoordinate(value: string): CellPosition | null {
  const match = /^([A-Z]+)([1-9][0-9]*)$/.exec(value);
  if (!match) return null;
  return { column: columnIndex(match[1]), row: Number(match[2]) - 1 };
}

export function cellCoordinate(row: number, column: number): string {
  return `${columnLabel(column)}${row + 1}`;
}

export function normalizeRange(selection: SelectionRange): NormalizedRange {
  const anchor = parseCellCoordinate(selection.anchor) ?? { row: 0, column: 0 };
  const focus = parseCellCoordinate(selection.focus) ?? anchor;
  return {
    minRow: Math.min(anchor.row, focus.row),
    maxRow: Math.max(anchor.row, focus.row),
    minColumn: Math.min(anchor.column, focus.column),
    maxColumn: Math.max(anchor.column, focus.column),
  };
}

export function isCellInRange(range: NormalizedRange, coordinate: string): boolean {
  const position = parseCellCoordinate(coordinate);
  if (!position) return false;
  return position.row >= range.minRow
    && position.row <= range.maxRow
    && position.column >= range.minColumn
    && position.column <= range.maxColumn;
}

/** Rectangle as a cell range label, normalized to top-left:bottom-right (for example `A1:C4`). */
export function rangeLabel(range: CellRange): string {
  const bounds = normalizeRange({ anchor: range.start, focus: range.end });
  return `${cellCoordinate(bounds.minRow, bounds.minColumn)}:${cellCoordinate(bounds.maxRow, bounds.maxColumn)}`;
}

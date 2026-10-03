import type { CellCoordinate, CellSelection } from "./types";

/** Converts a zero-based column index into its spreadsheet label (0 -> A, 26 -> AA). */
export function columnLabel(index: number): string {
  let remaining = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (remaining % 26)) + label;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return label;
}

/** Converts a spreadsheet column label back into its zero-based index (A -> 0, AA -> 26). */
export function columnIndexFromLabel(label: string): number {
  let index = 0;
  for (const character of label.toUpperCase()) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** Converts zero-based row/column indexes into an A1-style coordinate. */
export function cellCoordinate(row: number, col: number): string {
  return `${columnLabel(col)}${row + 1}`;
}

/** Parses an A1-style coordinate into `{row, col}` (zero-based) or null. */
export function parseCoordinate(key: string): CellCoordinate | null {
  const match = /^([A-Za-z]+)([0-9]+)$/.exec(key);
  if (!match) return null;
  return { row: Number(match[2]) - 1, col: columnIndexFromLabel(match[1]) };
}

export interface SelectionBounds {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

/** Normalizes an anchor/focus pair into the rectangle covering every selected cell. */
export function selectionBounds(selection: CellSelection): SelectionBounds {
  return {
    minRow: Math.min(selection.anchor.row, selection.focus.row),
    maxRow: Math.max(selection.anchor.row, selection.focus.row),
    minCol: Math.min(selection.anchor.col, selection.focus.col),
    maxCol: Math.max(selection.anchor.col, selection.focus.col),
  };
}

export function isCellSelected(selection: CellSelection, row: number, col: number): boolean {
  const bounds = selectionBounds(selection);
  return row >= bounds.minRow && row <= bounds.maxRow && col >= bounds.minCol && col <= bounds.maxCol;
}

/** The current (focused) cell inside the selection rectangle. */
export function currentCell(selection: CellSelection): CellCoordinate {
  return { row: selection.focus.row, col: selection.focus.col };
}

export function indexRange(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

/** True when both corners describe the exact same rectangle. */
export function sameSelection(a: CellSelection, b: CellSelection): boolean {
  return (
    a.anchor.row === b.anchor.row &&
    a.anchor.col === b.anchor.col &&
    a.focus.row === b.focus.row &&
    a.focus.col === b.focus.col
  );
}

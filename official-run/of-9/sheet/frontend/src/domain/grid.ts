import type { CellRecord } from "./types";

/** 0-based column index -> spreadsheet column label (A, B, ..., Z, AA, ...). */
export function columnLabel(index: number): string {
  let label = "";
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

/** 1-based row/column -> cell coordinate such as A1. */
export function cellCoordinate(row: number, column: number): string {
  return `${columnLabel(column - 1)}${row}`;
}

/** Parses a cell coordinate such as "A1" into 1-based row/column. */
export function parseCoordinate(coordinate: string): { row: number; column: number } | null {
  const match = /^([A-Z]+)(\d+)$/.exec(coordinate);
  if (!match) return null;
  let column = 0;
  for (const ch of match[1]) column = column * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(match[2]), column };
}

export interface GridPosition {
  row: number;
  column: number;
}

/** A selection is a rectangle between two corners; `start` is the anchor cell. */
export interface GridSelection {
  start: GridPosition;
  end: GridPosition;
}

/** Normalizes a selection so start is the top-left corner. */
export function normalizeSelection(selection: GridSelection): GridSelection {
  return {
    start: {
      row: Math.min(selection.start.row, selection.end.row),
      column: Math.min(selection.start.column, selection.end.column),
    },
    end: {
      row: Math.max(selection.start.row, selection.end.row),
      column: Math.max(selection.start.column, selection.end.column),
    },
  };
}

/** True when the 1-based row/column lies inside the selection rectangle. */
export function selectionContains(selection: GridSelection, row: number, column: number): boolean {
  const normalized = normalizeSelection(selection);
  return (
    row >= normalized.start.row &&
    row <= normalized.end.row &&
    column >= normalized.start.column &&
    column <= normalized.end.column
  );
}

/** Builds a single-cell selection. */
export function singleCellSelection(row: number, column: number): GridSelection {
  return { start: { row, column }, end: { row, column } };
}

/** Clamps a selection rectangle into the rendered grid bounds. */
export function clampSelection(selection: GridSelection, rows: number, columns: number): GridSelection {
  const normalized = normalizeSelection(selection);
  const clamp = (value: number, max: number) => Math.max(1, Math.min(value, max));
  return {
    start: { row: clamp(normalized.start.row, rows), column: clamp(normalized.start.column, columns) },
    end: { row: clamp(normalized.end.row, rows), column: clamp(normalized.end.column, columns) },
  };
}

/** Default visible grid extent used when the sheet data is smaller. */
export const MIN_GRID_ROWS = 20;
export const MIN_GRID_COLUMNS = 8;

/** Computes the rendered grid extent from the stored cells (min default grid). */
export function gridDimensions(cells: Record<string, CellRecord>): { rows: number; columns: number } {
  let maxRow = 0;
  let maxColumn = 0;
  for (const coordinate of Object.keys(cells)) {
    const parsed = parseCoordinate(coordinate);
    if (!parsed) continue;
    maxRow = Math.max(maxRow, parsed.row);
    maxColumn = Math.max(maxColumn, parsed.column);
  }
  return {
    rows: Math.max(maxRow, MIN_GRID_ROWS),
    columns: Math.max(maxColumn, MIN_GRID_COLUMNS),
  };
}

export function formatUpdated(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/**
 * Row structure operations (REQ-2-2-1).
 * Frontend mirror of backend/src/structure.js; the grid/editor and the API mock
 * share these pure helpers.
 */

import { columnLabel, columnNumber } from "./coords";

export type RowAction = "insert-above" | "insert-below" | "delete";

export const ROW_ACTIONS: RowAction[] = ["insert-above", "insert-below", "delete"];

/**
 * New 1-based row number for a cell/reference after a row operation at target.
 * - insert-above: rows >= target move down one (target becomes a blank row).
 * - insert-below: rows > target move down one.
 * - delete: the target row is removed and rows > target move up one; a
 *   reference pointing at the deleted row cannot be preserved and yields
 *   "#REF!".
 */
export function shiftRowNumber(
  row: number,
  action: RowAction,
  target: number,
): number | "#REF!" {
  if (action === "insert-above") return row >= target ? row + 1 : row;
  if (action === "insert-below") return row > target ? row + 1 : row;
  if (row === target) return "#REF!";
  return row > target ? row - 1 : row;
}

/**
 * Adjust A1-style references (letters + digits) in a formula/expression text
 * after a row operation. References that point at a deleted row become "#REF!".
 */
export function adjustCellRefs(text: string, action: RowAction, target: number): string {
  return text.replace(/(?<![A-Z])([A-Z]+)(\d+)/g, (_match, letters: string, digits: string) => {
    const shifted = shiftRowNumber(Number(digits), action, target);
    return shifted === "#REF!" ? "#REF!" : `${letters}${shifted}`;
  });
}

/**
 * Shift a sheet's cells (keyed by coordinate) for a row operation.
 * Cells on a deleted row are removed; formula text in shifted cells has its
 * references adjusted. Returns { cells, maxRow } where maxRow is the largest
 * row number present after the operation.
 */
export function shiftCells(
  cells: Record<string, string>,
  action: RowAction,
  target: number,
): { cells: Record<string, string>; maxRow: number } {
  const out: Record<string, string> = {};
  let maxRow = 0;
  for (const [coord, value] of Object.entries(cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(coord);
    if (!m) continue;
    const col = m[1];
    const row = Number(m[2]);
    if (action === "delete" && row === target) continue;
    const shifted = shiftRowNumber(row, action, target);
    if (shifted === "#REF!") continue;
    const newRow = shifted;
    const newCoord = `${col}${newRow}`;
    out[newCoord] = value.startsWith("=") ? adjustCellRefs(value, action, target) : value;
    if (newRow > maxRow) maxRow = newRow;
  }
  return { cells: out, maxRow };
}

/**
 * Adjust the row of an "A1"-style coordinate (e.g. a sheet's activeCell) after
 * a row operation. When the coordinate's row is deleted, the coordinate is kept
 * (the row now holds the content shifted up into it).
 */
export function shiftCoordinateRow(coord: string, action: RowAction, target: number): string {
  const m = /^([A-Z]+)(\d+)$/.exec(coord);
  if (!m) return coord;
  const shifted = shiftRowNumber(Number(m[2]), action, target);
  if (shifted === "#REF!") return coord;
  return `${m[1]}${shifted}`;
}

/* ------------------------------------------------------------------ */
/* Column structure operations (REQ-2-2-2).                            */
/* ------------------------------------------------------------------ */

export type ColumnAction = "insert-left" | "insert-right" | "delete";

export const COLUMN_ACTIONS: ColumnAction[] = ["insert-left", "insert-right", "delete"];

/**
 * New 1-based column number for a cell/reference after a column operation at
 * target (1-based).
 * - insert-left: columns >= target move right one (target becomes blank).
 * - insert-right: columns > target move right one.
 * - delete: the target column is removed and columns > target move left one; a
 *   reference pointing at the deleted column cannot be preserved and yields
 *   "#REF!".
 */
export function shiftColumnNumber(
  col: number,
  action: ColumnAction,
  target: number,
): number | "#REF!" {
  if (action === "insert-left") return col >= target ? col + 1 : col;
  if (action === "insert-right") return col > target ? col + 1 : col;
  if (col === target) return "#REF!";
  return col > target ? col - 1 : col;
}

/** New column label for a label after a column operation ("#REF!" on delete of that column). */
export function shiftColumnLabel(label: string, action: ColumnAction, target: number): string {
  const shifted = shiftColumnNumber(columnNumber(label), action, target);
  return shifted === "#REF!" ? "#REF!" : columnLabel(shifted - 1);
}

/**
 * Adjust A1-style references (letters + digits) in a formula/expression text
 * after a column operation. References that point at the deleted column become
 * "#REF!".
 */
export function adjustCellRefsColumn(
  text: string,
  action: ColumnAction,
  target: number,
): string {
  return text.replace(/(?<![A-Z])([A-Z]+)(\d+)/g, (_match, letters: string, digits: string) => {
    const shifted = shiftColumnLabel(letters, action, target);
    return shifted === "#REF!" ? "#REF!" : `${shifted}${digits}`;
  });
}

/**
 * Shift a sheet's cells (keyed by coordinate) for a column operation. Cells on
 * a deleted column are removed; formula text in shifted cells has its
 * references adjusted. Returns { cells, maxCol } where maxCol is the largest
 * column number present after the operation.
 */
export function shiftCellsColumn(
  cells: Record<string, string>,
  action: ColumnAction,
  target: number,
): { cells: Record<string, string>; maxCol: number } {
  const out: Record<string, string> = {};
  let maxCol = 0;
  for (const [coord, value] of Object.entries(cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(coord);
    if (!m) continue;
    const label = m[1];
    const row = m[2];
    if (action === "delete" && columnNumber(label) === target) continue;
    const shiftedLabel = shiftColumnLabel(label, action, target);
    if (shiftedLabel === "#REF!") continue;
    const newCoord = `${shiftedLabel}${row}`;
    out[newCoord] = value.startsWith("=") ? adjustCellRefsColumn(value, action, target) : value;
    const colNum = columnNumber(shiftedLabel);
    if (colNum > maxCol) maxCol = colNum;
  }
  return { cells: out, maxCol };
}

/**
 * Adjust the column of an "A1"-style coordinate (e.g. a sheet's activeCell)
 * after a column operation. When the coordinate's column is deleted, the
 * coordinate is kept (the column now holds the content shifted left into it).
 */
export function shiftCoordinateColumn(
  coord: string,
  action: ColumnAction,
  target: number,
): string {
  const m = /^([A-Z]+)(\d+)$/.exec(coord);
  if (!m) return coord;
  const shifted = shiftColumnLabel(m[1], action, target);
  if (shifted === "#REF!") return coord;
  return `${shifted}${m[2]}`;
}

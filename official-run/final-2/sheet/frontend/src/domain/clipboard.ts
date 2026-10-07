/**
 * External clipboard parsing and range transfer helpers.
 *
 * Pasted text uses tab-separated columns and newline-separated rows. Every
 * field is kept, including empty ones, so the pasted rectangle overwrites the
 * whole target area instead of silently dropping values; a single trailing
 * newline does not create an extra empty row. `rectangleCells` maps the parsed
 * matrix onto A1 coordinates starting at the target cell.
 *
 * For copying a worksheet rectangle the helpers below read the raw cell texts
 * (`rowsFromRegion`), describe the source area (`areaOfRegion`) and rewrite
 * copied formulas for the paste offset (`adjustRows`): relative references move
 * with the target offset while `$`-anchored parts keep pointing at the same
 * row or column.
 */

import { cellName, columnName, parseCellName, type CellRegion } from "./grid";

/** Splits pasted text into a row-major matrix of field strings. */
export function parseClipboardText(text: string): string[][] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => line.split("\t"));
}

/** Joins a row-major matrix back into tab/newline clipboard text. */
export function formatClipboardText(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.join("\t")).join("\n");
}

/** Updates `start`..rectangle of `rows` as `{ coordinate, value }` pairs. */
export function rectangleCells(start: string, rows: string[][]): Array<{ coordinate: string; value: string }> {
  const origin = parseCellName(start);
  if (!origin) return [];
  const updates: Array<{ coordinate: string; value: string }> = [];
  rows.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      updates.push({ coordinate: cellName(origin.row + rowIndex, origin.column + columnIndex), value });
    });
  });
  return updates;
}

/** Raw cell texts of `region` as a row-major matrix (empty string for blanks). */
export function rowsFromRegion(cells: Record<string, string>, region: CellRegion): string[][] {
  const rows: string[][] = [];
  for (let row = region.top; row <= region.bottom; row += 1) {
    const values: string[] = [];
    for (let column = region.left; column <= region.right; column += 1) {
      values.push(cells[cellName(row, column)] ?? "");
    }
    rows.push(values);
  }
  return rows;
}

/** Row-major empty strings covering `region`, used to clear it in one write. */
export function clearedRows(region: CellRegion): string[][] {
  return Array.from({ length: region.bottom - region.top + 1 }, () =>
    Array.from({ length: region.right - region.left + 1 }, () => ""),
  );
}

/** A1 area text of a rectangle, for example `A1:B2`; a single cell stays `A1`. */
export function areaOfRegion(region: CellRegion): string {
  const start = cellName(region.top, region.left);
  const end = cellName(region.bottom, region.right);
  return start === end ? start : `${start}:${end}`;
}

const REFERENCE_PATTERN = /(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]*)/g;

function columnIndex(letters: string): number {
  let value = 0;
  for (const letter of letters.toUpperCase()) value = value * 26 + (letter.charCodeAt(0) - 64);
  return value;
}

/**
 * Rewrites one copied formula for a paste offset. Relative references shift by
 * `rowOffset`/`columnOffset`, while a `$` before the column or row keeps that
 * part anchored; a reference pushed off the grid becomes `#REF!`. Text that is
 * not part of a cell reference (function names, plain values) is left alone.
 */
export function adjustFormulaText(formula: string, rowOffset: number, columnOffset: number): string {
  if (!formula.startsWith("=")) return formula;
  if (rowOffset === 0 && columnOffset === 0) return formula;
  return formula.replace(
    REFERENCE_PATTERN,
    (match, columnAbsolute: string, letters: string, rowAbsolute: string, rowDigits: string, offset: number, source: string) => {
      const previous = offset > 0 ? source[offset - 1] : "";
      const following = source[offset + match.length] ?? "";
      if (/[A-Za-z0-9_$]/.test(previous) || /[A-Za-z0-9_]/.test(following)) return match;
      const column = columnAbsolute ? columnIndex(letters) : columnIndex(letters) + columnOffset;
      const row = rowAbsolute ? Number(rowDigits) : Number(rowDigits) + rowOffset;
      if (column < 1 || row < 1) return "#REF!";
      return `${columnAbsolute}${columnName(column)}${rowAbsolute}${row}`;
    },
  );
}

/** Copies a row-major matrix, adjusting formula cells for the paste offset. */
export function adjustRows(rows: readonly (readonly string[])[], rowOffset: number, columnOffset: number): string[][] {
  if (rowOffset === 0 && columnOffset === 0) return rows.map((row) => [...row]);
  return rows.map((row) => row.map((value) => adjustFormulaText(value, rowOffset, columnOffset)));
}

/**
 * Range transfer logic (REQ-3-2-1), mirror of backend/src/transfer.js.
 * Pure helpers shared by the api mock and unit tests; the authoritative
 * implementation runs on the backend.
 */

import { cellCoordinate, columnLabel, columnNumber } from "./coords";

export type TransferOperation = "copy" | "cut";

export const TRANSFER_OPERATIONS: TransferOperation[] = ["copy", "cut"];

export interface NormalizedRect {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
  topLeft: string;
  bottomRight: string;
}

/**
 * Normalize a {current, end} pair into a rectangle with 1-based inclusive
 * column/row bounds plus the top-left and bottom-right coordinate labels.
 * Returns null when either coordinate is not a valid "A1"-style cell.
 */
export function normalizeRect(current: string, end: string): NormalizedRect | null {
  const m1 = /^([A-Z]+)(\d+)$/.exec(String(current ?? "").toUpperCase());
  const m2 = /^([A-Z]+)(\d+)$/.exec(String(end ?? "").toUpperCase());
  if (!m1 || !m2) return null;
  const c1 = columnNumber(m1[1]);
  const c2 = columnNumber(m2[1]);
  const r1 = Number(m1[2]);
  const r2 = Number(m2[2]);
  if (r1 < 1 || r2 < 1) return null;
  const minCol = Math.min(c1, c2);
  const maxCol = Math.max(c1, c2);
  const minRow = Math.min(r1, r2);
  const maxRow = Math.max(r1, r2);
  return {
    minCol,
    maxCol,
    minRow,
    maxRow,
    topLeft: `${columnLabel(minCol - 1)}${minRow}`,
    bottomRight: `${columnLabel(maxCol - 1)}${maxRow}`,
  };
}

/**
 * Adjust A1-style references inside formula text by a (deltaCol, deltaRow)
 * offset (1-based column delta, 1-based row delta). Relative column/row shift
 * with the offset; "$"-prefixed parts stay fixed. A reference whose adjusted
 * position falls outside the sheet (column < 1 or row < 1) becomes "#REF!".
 */
export function adjustFormulaRefs(text: string, deltaCol: number, deltaRow: number): string {
  if (typeof text !== "string") return text;
  return text.replace(
    /(?<![A-Za-z])(\$?)([A-Za-z]+)(\$?)(\d+)/g,
    (_match, absCol: string, letters: string, absRow: string, digits: string) => {
      const col = columnNumber(letters.toUpperCase());
      const row = Number(digits);
      const newCol = absCol ? col : col + deltaCol;
      const newRow = absRow ? row : row + deltaRow;
      if (newCol < 1 || newRow < 1) return "#REF!";
      return `${absCol ? "$" : ""}${columnLabel(newCol - 1)}${absRow ? "$" : ""}${newRow}`;
    },
  );
}

function coordInRect(coord: string, rect: NormalizedRect): boolean {
  const m = /^([A-Z]+)(\d+)$/.exec(coord);
  if (!m) return false;
  const col = columnNumber(m[1]);
  const row = Number(m[2]);
  return col >= rect.minCol && col <= rect.maxCol && row >= rect.minRow && row <= rect.maxRow;
}

/**
 * Apply a copy/cut transfer to a cells map (see backend/src/transfer.js).
 * Returns { cells, end } where end is the target rectangle's bottom-right
 * coordinate.
 */
export function applyRangeTransfer(
  cells: Record<string, string>,
  operation: TransferOperation,
  sourceRect: NormalizedRect,
  targetTopLeft: { col: number; row: number },
): { cells: Record<string, string>; end: string } {
  const width = sourceRect.maxCol - sourceRect.minCol + 1;
  const height = sourceRect.maxRow - sourceRect.minRow + 1;
  const deltaCol = targetTopLeft.col - sourceRect.minCol;
  const deltaRow = targetTopLeft.row - sourceRect.minRow;
  const targetRect: NormalizedRect = {
    minCol: targetTopLeft.col,
    maxCol: targetTopLeft.col + width - 1,
    minRow: targetTopLeft.row,
    maxRow: targetTopLeft.row + height - 1,
    topLeft: "",
    bottomRight: "",
  };
  const snapshot: { c: number; r: number; value: string }[] = [];
  for (let r = 0; r < height; r += 1) {
    for (let c = 0; c < width; c += 1) {
      const coord = cellCoordinate(sourceRect.minCol - 1 + c, sourceRect.minRow - 1 + r);
      let value = cells[coord] ?? "";
      if (value.startsWith("=")) value = adjustFormulaRefs(value, deltaCol, deltaRow);
      snapshot.push({ c, r, value });
    }
  }
  const out = { ...cells };
  for (const { c, r, value } of snapshot) {
    const coord = cellCoordinate(targetTopLeft.col - 1 + c, targetTopLeft.row - 1 + r);
    if (value === "") delete out[coord];
    else out[coord] = value;
  }
  if (operation === "cut") {
    for (let r = 0; r < height; r += 1) {
      for (let c = 0; c < width; c += 1) {
        const coord = cellCoordinate(sourceRect.minCol - 1 + c, sourceRect.minRow - 1 + r);
        if (!coordInRect(coord, targetRect)) delete out[coord];
      }
    }
  }
  const end = cellCoordinate(targetTopLeft.col - 1 + width - 1, targetTopLeft.row - 1 + height - 1);
  return { cells: out, end };
}

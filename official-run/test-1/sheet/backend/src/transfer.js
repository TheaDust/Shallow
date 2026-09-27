/**
 * Range transfer logic (REQ-3-2-1): copy/cut a rectangular range to a target
 * location inside the same worksheet. Pure helpers shared by the store and
 * unit tests; the frontend mirrors this module in src/transfer.ts.
 *
 * Copy keeps the source range untouched; cut clears the source range only as
 * part of the same atomic operation that writes the complete target range.
 * Values and formulas keep their two-dimensional layout. Formula references
 * are adjusted by the target offset: relative references shift with the
 * offset, absolute references ("$A$1") stay unchanged, mixed references keep
 * the absolute part, and a reference shifted outside the sheet becomes
 * "#REF!".
 */

import { cellCoordinate, columnLabel, columnNumber } from "./coords.js";

export const TRANSFER_OPERATIONS = ["copy", "cut"];

/**
 * Normalize a {current, end} pair into a rectangle with 1-based inclusive
 * column/row bounds plus the top-left and bottom-right coordinate labels.
 * Returns null when either coordinate is not a valid "A1"-style cell.
 */
export function normalizeRect(current, end) {
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
export function adjustFormulaRefs(text, deltaCol, deltaRow) {
  if (typeof text !== "string") return text;
  return text.replace(
    /(?<![A-Za-z])(\$?)([A-Za-z]+)(\$?)(\d+)/g,
    (_match, absCol, letters, absRow, digits) => {
      const col = columnNumber(letters.toUpperCase());
      const row = Number(digits);
      const newCol = absCol ? col : col + deltaCol;
      const newRow = absRow ? row : row + deltaRow;
      if (newCol < 1 || newRow < 1) return "#REF!";
      return `${absCol ? "$" : ""}${columnLabel(newCol - 1)}${absRow ? "$" : ""}${newRow}`;
    },
  );
}

function coordInRect(coord, rect) {
  const m = /^([A-Z]+)(\d+)$/.exec(coord);
  if (!m) return false;
  const col = columnNumber(m[1]);
  const row = Number(m[2]);
  return col >= rect.minCol && col <= rect.maxCol && row >= rect.minRow && row <= rect.maxRow;
}

/**
 * Apply a copy/cut transfer to a cells map.
 * - copy: the source range is left unchanged; the target rectangle is written
 *   from a snapshot of the source values (empty source cells clear targets).
 * - cut: the target rectangle is written first, then source cells that do not
 *   overlap the target rectangle are cleared; pasting a range back onto
 *   itself is a no-op.
 * Formulas are adjusted by the target offset in both modes. Returns
 * { cells, end } where end is the target rectangle's bottom-right coordinate.
 */
export function applyRangeTransfer(cells, operation, sourceRect, targetTopLeft) {
  const width = sourceRect.maxCol - sourceRect.minCol + 1;
  const height = sourceRect.maxRow - sourceRect.minRow + 1;
  const deltaCol = targetTopLeft.col - sourceRect.minCol;
  const deltaRow = targetTopLeft.row - sourceRect.minRow;
  const targetRect = {
    minCol: targetTopLeft.col,
    maxCol: targetTopLeft.col + width - 1,
    minRow: targetTopLeft.row,
    maxRow: targetTopLeft.row + height - 1,
  };
  const snapshot = [];
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

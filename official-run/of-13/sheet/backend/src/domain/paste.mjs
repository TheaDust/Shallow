/**
 * Bulk paste of external clipboard text into one worksheet.
 *
 * The text is interpreted as a rectangle: tab-separated columns, newline-separated rows
 * (`\r\n` and `\r` are accepted). Empty fields are preserved, every cell of the rectangle
 * is written (formulas inside it are replaced by the pasted text), and cells outside the
 * rectangle are never touched. Either the whole rectangle is applied or nothing is: an
 * out-of-bounds rectangle or a data-validation rejection returns an error and leaves every
 * target cell with its original value.
 */

import { cellAddress } from "./address.mjs";
import { addressInsideGrid } from "./cells.mjs";
import { sheetColumnCount, sheetRowCount } from "./structure.mjs";
import { validationMessageFor } from "./validation.mjs";

export const PASTE_OUT_OF_GRID_MESSAGE = "The pasted range does not fit in the worksheet";
export const PASTE_START_INVALID_MESSAGE = "Invalid cell address";

/** Splits pasted text into rows of fields; a single trailing line break adds no row. */
export function parsePastedText(text) {
  const normalized = String(text ?? "").replace(/\r\n?/g, "\n");
  if (normalized === "") return [];
  const lines = normalized.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => line.split("\t"));
}

/**
 * Applies pasted `text` starting at `start` (top-left of the rectangle).
 * @returns {{ ok: true, cells: number } | { ok: false, error: string }}
 */
export function applyPaste(sheet, { start, text }) {
  if (typeof start !== "string" || !addressInsideGrid(sheet, start)) {
    return { ok: false, error: PASTE_START_INVALID_MESSAGE };
  }
  if (typeof text !== "string") return { ok: false, error: "Invalid paste data" };
  const rows = parsePastedText(text);
  if (rows.length === 0) return { ok: true, cells: 0 };

  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  const origin = /^([A-Z]+)(\d+)$/.exec(start.toUpperCase());
  const originColumn = (() => {
    let column = 0;
    for (const letter of origin[1]) column = column * 26 + (letter.charCodeAt(0) - 64);
    return column;
  })();
  const originRow = Number(origin[2]);

  if (
    originRow + rows.length - 1 > sheetRowCount(sheet) ||
    originColumn + width - 1 > sheetColumnCount(sheet)
  ) {
    return { ok: false, error: PASTE_OUT_OF_GRID_MESSAGE };
  }

  const targets = [];
  for (let row = 0; row < rows.length; row += 1) {
    const fields = rows[row];
    for (let column = 0; column < width; column += 1) {
      const address = cellAddress(originRow - 1 + row, originColumn - 1 + column);
      const value = fields[column] ?? "";
      const rejected = validationMessageFor(sheet, address, value);
      if (rejected) return { ok: false, error: rejected };
      targets.push({ address, value });
    }
  }

  for (const { address, value } of targets) {
    if (value === "") delete sheet.cells[address];
    else sheet.cells[address] = value;
  }
  return { ok: true, cells: targets.length };
}

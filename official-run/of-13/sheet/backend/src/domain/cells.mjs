/**
 * Writing a single cell of one worksheet. The address is normalized to the upper-case A1
 * form used everywhere else, must exist inside the worksheet grid, and the submitted value
 * must be a string; a validation rule covering the cell can reject it. A rejected write
 * returns an error and leaves the worksheet untouched, so callers keep the last successful
 * value (and every dependent formula keeps its previous result).
 */

import { cellAddress, parseAddress } from "./address.mjs";
import { sheetColumnCount, sheetRowCount } from "./structure.mjs";
import { validationMessageFor } from "./validation.mjs";

export const CELL_ADDRESS_INVALID_MESSAGE = "Invalid cell address";
export const CELL_VALUE_INVALID_MESSAGE = "Invalid cell value";
export const PASTE_DATA_INVALID_MESSAGE = "Invalid paste data";

/** True when the address is a valid A1 coordinate inside the worksheet grid. */
export function addressInsideGrid(sheet, address) {
  const position = parseAddress(address);
  if (!position) return false;
  return position.row < sheetRowCount(sheet) && position.column < sheetColumnCount(sheet);
}

/**
 * Writes `value` (raw text; a formula starts with `=`) into one cell.
 * @returns {{ ok: true } | { ok: false, error: string }} mutating `sheet` only on success
 */
export function setCellValue(sheet, address, value) {
  if (typeof value !== "string") return { ok: false, error: CELL_VALUE_INVALID_MESSAGE };
  if (!addressInsideGrid(sheet, address)) return { ok: false, error: CELL_ADDRESS_INVALID_MESSAGE };
  const normalized = cellAddress(
    parseAddress(address).row,
    parseAddress(address).column,
  );
  const rejected = validationMessageFor(sheet, normalized, value);
  if (rejected) return { ok: false, error: rejected };
  if (value === "") delete sheet.cells[normalized];
  else sheet.cells[normalized] = value;
  return { ok: true };
}

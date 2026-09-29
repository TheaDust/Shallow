/**
 * Cell write path of a worksheet.
 *
 * One call applies a whole set of raw cell texts (a single edit or a pasted
 * rectangle) as an all-or-nothing operation: every coordinate is validated and
 * checked against the worksheet's validation rules first, and only when all of
 * them pass is the stored `cells` record updated. A rejected call leaves the
 * worksheet exactly as it was, so no partial write can be observed.
 */

import { parseCellAddress } from "./coordinates.mjs";
import { GRID_COLUMN_COUNT, GRID_ROW_COUNT } from "./structure.mjs";
import { validateCellText } from "./validation.mjs";

export const INVALID_CELL_ADDRESS_MESSAGE = "Invalid cell address";
export const INVALID_CELL_VALUE_MESSAGE = "Invalid cell value";
export const OUT_OF_GRID_MESSAGE = "Cell is outside the worksheet bounds";

function normalizeAddress(value) {
  if (typeof value !== "string") return null;
  const address = value.trim().toUpperCase();
  const coordinate = parseCellAddress(address);
  if (!coordinate) return null;
  if (coordinate.column > GRID_COLUMN_COUNT || coordinate.row > GRID_ROW_COUNT) return null;
  return address;
}

/**
 * Validates the submitted `{ "A1": "text" }` map. Returns
 * `{ ok: true, entries }` with `[address, rawText]` pairs (an empty text clears
 * the cell) or `{ ok: false, error }`.
 */
export function normalizeCellUpdates(updates) {
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    return { ok: false, error: INVALID_CELL_VALUE_MESSAGE };
  }
  const entries = [];
  for (const [address, value] of Object.entries(updates)) {
    const normalized = normalizeAddress(address);
    if (!normalized) return { ok: false, error: INVALID_CELL_ADDRESS_MESSAGE };
    if (value === null || value === undefined) {
      entries.push([normalized, ""]);
      continue;
    }
    if (typeof value !== "string") return { ok: false, error: INVALID_CELL_VALUE_MESSAGE };
    entries.push([normalized, value]);
  }
  return { ok: true, entries };
}

/**
 * Applies raw cell texts to a worksheet in place. Returns `{ ok: true }` after
 * updating every target, or `{ ok: false, error }` without touching the
 * worksheet when an address, a value or a validation rule rejects the write.
 */
export function applyCellUpdates(worksheet, updates) {
  const normalized = normalizeCellUpdates(updates);
  if (!normalized.ok) return normalized;
  const { entries } = normalized;
  for (const [address, rawText] of entries) {
    const violation = validateCellText(worksheet, address, rawText);
    if (violation) return { ok: false, error: violation };
  }
  for (const [address, rawText] of entries) {
    if (rawText === "") delete worksheet.cells[address];
    else worksheet.cells[address] = rawText;
  }
  return { ok: true };
}

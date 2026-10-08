/**
 * Cell notes of a worksheet: free text attached to one A1 coordinate, kept
 * apart from the cell value so saving, editing or deleting a note never
 * rewrites what the cell displays. The helpers are pure and validate the whole
 * payload before the store's single atomic write, so a rejected note leaves the
 * stored notes untouched.
 */

import { ValidationError } from "../lib/errors.mjs";
import { cellName, parseCellName } from "./grid.mjs";
import { shiftArea } from "./structure.mjs";

/** Exact message of a note whose text is not usable. */
export const INVALID_NOTE_MESSAGE = "Invalid cell note";
/** Exact message of a note whose text is empty after trimming. */
export const EMPTY_NOTE_MESSAGE = "Note text cannot be empty";

/** Upper-cases and validates an A1 coordinate, or throws `ValidationError`. */
export function normalizeNoteCoordinate(value) {
  const parsed = typeof value === "string" ? parseCellName(value) : null;
  if (!parsed) throw new ValidationError(INVALID_NOTE_MESSAGE);
  return cellName(parsed.row, parsed.column);
}

/**
 * Note text to store: any non-empty string, kept exactly as submitted (only
 * blank text is rejected). A note never carries a formula, so no value is
 * derived from it.
 */
export function normalizeNoteText(value) {
  if (typeof value !== "string") throw new ValidationError(INVALID_NOTE_MESSAGE);
  if (value.trim() === "") throw new ValidationError(EMPTY_NOTE_MESSAGE);
  return value;
}

/**
 * Notes of one worksheet after a row/column change of that worksheet: each
 * note follows the cell it is attached to, and a note whose cell was deleted
 * by the removed line is dropped with it. `null`/absent means no notes.
 */
export function shiftNotes(notes, { axis, mode, index } = {}) {
  if (notes === null || typeof notes !== "object" || Array.isArray(notes)) return notes;
  const coordinates = Object.keys(notes);
  if (coordinates.length === 0) return notes;
  const at = mode === "insert-after" ? index + 1 : index;
  const change = mode === "delete" ? "delete" : "insert-before";
  const next = {};
  for (const coordinate of coordinates) {
    const moved = shiftArea(coordinate, axis, change, at);
    if (!moved) continue;
    next[moved] = notes[coordinate];
  }
  return next;
}

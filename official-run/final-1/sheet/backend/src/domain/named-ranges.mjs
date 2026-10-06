/**
 * Named ranges of a workbook: a name usable inside formulas as a reference to
 * an A1 area, optionally qualified with the worksheet name (`Sheet1!A1:B2`).
 *
 * Names must start with a letter; that is the only documented constraint, so a
 * name is accepted verbatim once trimmed (only its address shape matters to the
 * formula engine). The range text is canonicalised (trimmed, coordinates
 * uppercased and ordered) so the dialog shows the same text a later refresh
 * restores.
 */

import { ValidationError } from "../lib/errors.mjs";
import { cellName, parseArea } from "./grid.mjs";
import { shiftArea } from "./structure.mjs";

export const NAMED_RANGE_NAME_MESSAGE = "Named range must start with a letter";
export const INVALID_NAMED_RANGE_MESSAGE = "Enter a valid cell range";
export const NAMED_RANGE_MISSING_MESSAGE = "Named range not found";
export const DUPLICATE_NAMED_RANGE_MESSAGE = "Named range name already exists";

/** A name must start with a letter (the rest is free text). */
const NAME_PATTERN = /^[A-Za-z]/;

/** Validated named-range name, or throws `ValidationError`. */
export function normalizeNamedRangeName(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!NAME_PATTERN.test(trimmed)) throw new ValidationError(NAMED_RANGE_NAME_MESSAGE);
  return trimmed;
}

/**
 * Splits `Sheet!A1:B2` into its optional worksheet qualifier and its A1 area.
 * A qualifier that is present but empty is malformed.
 */
export function splitNamedRange(range) {
  if (typeof range !== "string") return null;
  const text = range.trim();
  const bang = text.indexOf("!");
  const sheet = bang === -1 ? "" : text.slice(0, bang).trim();
  const area = (bang === -1 ? text : text.slice(bang + 1)).trim();
  if (bang !== -1 && !sheet) return null;
  return { sheet, area };
}

/**
 * Canonical range text of a named range: `Sheet!A1:B2` (or `A1:B2` without a
 * worksheet qualifier), or throws `ValidationError` when the area is malformed.
 */
export function normalizeNamedRangeRange(value) {
  const parts = splitNamedRange(value);
  const bounds = parts ? parseArea(parts.area) : null;
  if (!bounds) throw new ValidationError(INVALID_NAMED_RANGE_MESSAGE);
  const start = cellName(bounds.top, bounds.left);
  const end = cellName(bounds.bottom, bounds.right);
  const area = start === end ? start : `${start}:${end}`;
  return parts.sheet ? `${parts.sheet}!${area}` : area;
}

/** True when `name` equals the stored name without regard to letter case. */
export function sameNamedRangeName(left, right) {
  return String(left ?? "").trim().toLowerCase() === String(right ?? "").trim().toLowerCase();
}

/**
 * Named range after a row/column change of one worksheet: the area follows its
 * cells when the range applies to that worksheet (its own qualifier or none).
 * `null` means the deleted line covered the whole area, so the entry is dropped.
 */
export function shiftNamedRange(range, worksheetName, { axis, mode, index }) {
  const parts = splitNamedRange(range);
  if (!parts) return null;
  if (parts.sheet && !sameNamedRangeName(parts.sheet, worksheetName)) return range;
  const at = mode === "insert-after" ? index + 1 : index;
  const change = mode === "delete" ? "delete" : "insert-before";
  const moved = shiftArea(parts.area, axis, change, at);
  if (!moved) return null;
  return parts.sheet ? `${parts.sheet}!${moved}` : moved;
}

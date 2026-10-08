/**
 * Workbook-level named ranges.
 *
 * A named range pairs a formula name with a range reference such as
 * `ForecastModel!J3:J5` (a bare `J3:J5` without a sheet also works). The name
 * must start with a letter and the reference must be a valid A1 cell or area;
 * both are validated here so a rejected save never reaches the stored state.
 * Formulas resolve a saved name to the cells of its range on the sheet that
 * owns it (the frontend formula engine reads the same reference).
 */

import { ValidationError } from "../lib/errors.mjs";
import { cellName, parseArea } from "./grid.mjs";

/** Rejection text when the entered name does not start with a letter. */
export const NAMED_RANGE_NAME_MESSAGE = "Named range must start with a letter";
/** Rejection text when the entered name is not a usable formula name. */
export const NAMED_RANGE_NAME_INVALID_MESSAGE = "Invalid named range name";
/** Rejection text when the entered reference is not a cell or area. */
export const INVALID_NAMED_RANGE_MESSAGE = "Enter a valid cell range";
/** A usable formula name: a letter followed by letters, digits or underscores. */
const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Canonical `[Sheet!]A1[:B2]` reference of a named range, or `null` when the
 * text is not a valid single cell or area. The optional sheet name is kept as
 * typed; the A1 part is uppercased and normalised, so `j5:j3` becomes `J3:J5`.
 */
export function parseNamedRangeReference(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const separator = text.lastIndexOf("!");
  let sheet = null;
  let areaText = text;
  if (separator !== -1) {
    sheet = text.slice(0, separator).trim();
    areaText = text.slice(separator + 1).trim();
    if (!sheet) return null;
  }
  const bounds = parseArea(areaText);
  if (!bounds) return null;
  const start = cellName(bounds.top, bounds.left);
  const end = cellName(bounds.bottom, bounds.right);
  const area = start === end ? start : `${start}:${end}`;
  return sheet ? `${sheet}!${area}` : area;
}

/**
 * Validated, canonical `{ name, range }` entry, or throws `ValidationError`.
 * A name that does not start with a letter keeps the requirement's exact text;
 * other unusable names and malformed references carry their own message.
 */
export function normalizeNamedRange({ name, range } = {}) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!/^[A-Za-z]/.test(trimmed)) throw new ValidationError(NAMED_RANGE_NAME_MESSAGE);
  if (!NAME_PATTERN.test(trimmed)) throw new ValidationError(NAMED_RANGE_NAME_INVALID_MESSAGE);
  const reference = parseNamedRangeReference(range);
  if (!reference) throw new ValidationError(INVALID_NAMED_RANGE_MESSAGE);
  return { name: trimmed, range: reference };
}

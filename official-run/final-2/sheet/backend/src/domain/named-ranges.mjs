/**
 * Named ranges of a workbook.
 *
 * A workbook may carry a `namedRanges` array of `{ name, range }` entries,
 * where `range` is a sheet-qualified A1 area such as `ForecastModel!J3:J5`. A
 * saved name can be used inside a formula as a range reference (the frontend
 * calculation engine resolves it), so the stored text keeps both the worksheet
 * name and the canonical area of that sheet.
 *
 * This module owns the user-visible rejection message and the canonical text;
 * the store resolves the worksheet name and persists the entry atomically.
 */

import { ValidationError } from "../lib/errors.mjs";
import { cellName, parseArea } from "./grid.mjs";

export const NAMED_RANGE_NAME_MESSAGE = "Named range must start with a letter";
export const INVALID_NAMED_RANGE_MESSAGE = "Invalid named range";

/**
 * Name of a saved range: trimmed and required to start with a letter, which is
 * what makes it usable as a range reference. Anything else (an empty name, a
 * leading digit) is rejected with `NAMED_RANGE_NAME_MESSAGE`.
 */
export function normalizeNamedRangeName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z]/.test(name)) throw new ValidationError(NAMED_RANGE_NAME_MESSAGE);
  return name;
}

/** Canonical `A1` / `A1:B2` text of parsed bounds. */
function areaText(bounds) {
  const start = cellName(bounds.top, bounds.left);
  const end = cellName(bounds.bottom, bounds.right);
  return start === end ? start : `${start}:${end}`;
}

/**
 * Splits a sheet-qualified area such as `ForecastModel!J3:J5` into its
 * worksheet name and its canonical area text, or `null` when the text is not a
 * worksheet-qualified A1 cell/area.
 */
export function parseNamedRangeArea(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const separator = text.lastIndexOf("!");
  if (separator <= 0 || separator === text.length - 1) return null;
  const sheet = text.slice(0, separator).trim();
  if (sheet === "") return null;
  const bounds = parseArea(text.slice(separator + 1));
  if (!bounds) return null;
  return { sheet, area: areaText(bounds) };
}

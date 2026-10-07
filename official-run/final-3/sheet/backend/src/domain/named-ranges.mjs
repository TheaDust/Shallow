/**
 * Workbook-level named ranges: a stable name bound to an A1 area of one
 * worksheet. Names become available as range references inside formulas, so a
 * name has to start with a letter (a leading digit would read as a number) and
 * is unique within the workbook, ignoring letter case.
 *
 * The module is pure: it only validates and canonicalises the payload the HTTP
 * layer received, and the store performs the atomic write.
 */

import { cellName, parseArea } from "./grid.mjs";

/** Message shown for a name that does not start with a letter. */
export const NAMED_RANGE_NAME_MESSAGE = "Named range must start with a letter";
/** Message shown for a malformed or missing range. */
export const INVALID_NAMED_RANGE_MESSAGE = "Invalid named range";

/** Trimmed name of a named range, or an empty string when it is not a string. */
export function trimNamedRangeName(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Reason `value` cannot be a named-range name, or `null` when it can. A name
 * must be non-empty and start with a letter, so it never collides with the
 * numeric or cell-address literals of a formula.
 */
export function namedRangeNameError(value) {
  return /^[A-Za-z]/.test(trimNamedRangeName(value)) ? null : NAMED_RANGE_NAME_MESSAGE;
}

/**
 * Canonical `A1` / `A1:B2` text of an area, or `null` when `value` is not a
 * valid area. Storing the canonical form keeps `B2:A1` and `A1:B2` the same
 * named range.
 */
export function canonicalArea(value) {
  const bounds = parseArea(value);
  if (!bounds) return null;
  const start = cellName(bounds.top, bounds.left);
  const end = cellName(bounds.bottom, bounds.right);
  return start === end ? start : `${start}:${end}`;
}

/** True when `name` matches `candidate`, ignoring letter case. */
export function sameNamedRangeName(name, candidate) {
  return trimNamedRangeName(name).toLowerCase() === trimNamedRangeName(candidate).toLowerCase();
}

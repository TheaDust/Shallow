/**
 * Client-side helpers for the workbook's named ranges.
 *
 * A saved name is stored on the workbook as `{ name, range }`, where `range`
 * is a sheet-qualified A1 area (`ForecastModel!J3:J5`). The server owns the
 * stored text and rejects a name that does not start with a letter; this
 * module parses the stored text for the calculation engine and lists the names
 * the dialog shows.
 */

import { cellName, parseCellName } from "./grid";
import type { NamedRange } from "./types";

export const NAMED_RANGE_NAME_MESSAGE = "Named range must start with a letter";
export const INVALID_NAMED_RANGE_MESSAGE = "Invalid named range";

/** A parsed named range: the worksheet it reads plus its inclusive coordinates. */
export interface NamedRangeReference {
  sheet: string;
  start: string;
  end: string;
}

/** Saved names of a workbook, in save order; an absent list means none. */
export function namedRangeEntries(ranges: NamedRange[] | undefined): NamedRange[] {
  return Array.isArray(ranges) ? ranges : [];
}

/**
 * Parses a sheet-qualified A1 cell or area such as `ForecastModel!J3:J5` (or
 * `ForecastModel!K2`, a single cell) into its worksheet name and canonical
 * coordinates, or `null` when the text is not such a reference.
 */
export function parseNamedRangeReference(value: unknown): NamedRangeReference | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const separator = text.lastIndexOf("!");
  if (separator <= 0 || separator === text.length - 1) return null;
  const sheet = text.slice(0, separator).trim();
  if (sheet === "") return null;
  const parts = text.slice(separator + 1).trim().split(":");
  if (parts.length < 1 || parts.length > 2) return null;
  const first = parseCellName(parts[0]);
  const last = parts.length === 2 ? parseCellName(parts[1]) : first;
  if (!first || !last) return null;
  return {
    sheet,
    start: cellName(Math.min(first.row, last.row), Math.min(first.column, last.column)),
    end: cellName(Math.max(first.row, last.row), Math.max(first.column, last.column)),
  };
}

/** True when `name` is usable as a range reference: it starts with a letter. */
export function isValidNamedRangeName(name: string): boolean {
  return /^[A-Za-z]/.test(name.trim());
}

/**
 * Client-side helpers for the workbook's named ranges.
 *
 * A saved name pairs a formula name with a reference such as
 * `ForecastModel!J3:J5`; the formula engine receives the coordinates that apply
 * to the active sheet, so a name used in a formula reads the same cells as its
 * A1 area would. The dialog validates the same rules the server enforces: the
 * name must start with a letter and the reference must be a cell or area.
 */

import { cellName, parseCellName } from "./grid";
import type { NamedRangeMap } from "./formula";
import type { NamedRange } from "./types";

/** Rejection text shown when the entered name does not start with a letter. */
export const NAMED_RANGE_NAME_MESSAGE = "Named range must start with a letter";
/** Rejection text shown when the entered reference is not a cell or area. */
export const INVALID_NAMED_RANGE_MESSAGE = "Enter a valid cell range";

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/** True when the trimmed name starts with a letter (the requirement's rule). */
export function namedRangeStartsWithLetter(name: string): boolean {
  return /^[A-Za-z]/.test(name.trim());
}

/** True when the trimmed name is a usable formula name. */
export function namedRangeNameValid(name: string): boolean {
  return NAME_PATTERN.test(name.trim());
}

/**
 * Parses `[Sheet!]A1[:B2]` into its optional sheet and canonical coordinates, or
 * `null` when the text is not a valid cell or area. The sheet name is kept as
 * typed; the A1 part is uppercased and normalised (`j5:j3` becomes `J3`..`J5`).
 */
export function parseNamedRangeReference(
  value: string,
): { sheet: string | null; start: string; end: string } | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const separator = text.lastIndexOf("!");
  let sheet: string | null = null;
  let areaText = text;
  if (separator !== -1) {
    sheet = text.slice(0, separator).trim();
    areaText = text.slice(separator + 1).trim();
    if (!sheet) return null;
  }
  const [startText, endText = startText] = areaText.split(":");
  const first = parseCellName(startText);
  const last = parseCellName(endText);
  if (!first || !last) return null;
  const top = Math.min(first.row, last.row);
  const bottom = Math.max(first.row, last.row);
  const left = Math.min(first.column, last.column);
  const right = Math.max(first.column, last.column);
  return { sheet, start: cellName(top, left), end: cellName(bottom, right) };
}

/**
 * Coordinates of every named range that applies to `worksheetName`: a range
 * without a sheet applies anywhere, one with a sheet only on that sheet (the
 * comparison ignores letter case). Names are keyed uppercased so a formula
 * resolves them case-insensitively.
 */
export function buildNamedRangeMap(
  namedRanges: NamedRange[] | undefined,
  worksheetName: string,
): NamedRangeMap {
  const map: NamedRangeMap = {};
  if (!Array.isArray(namedRanges)) return map;
  const wanted = worksheetName.trim().toLowerCase();
  for (const entry of namedRanges) {
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    const parsed = parseNamedRangeReference(entry?.range ?? "");
    if (!name || !parsed) continue;
    if (parsed.sheet !== null && parsed.sheet.toLowerCase() !== wanted) continue;
    map[name.toUpperCase()] = { start: parsed.start, end: parsed.end };
  }
  return map;
}

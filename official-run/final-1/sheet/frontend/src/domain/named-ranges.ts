/**
 * Named ranges as the editor and the formula engine use them: the name is free
 * text that must start with a letter, and the range is an A1 area optionally
 * qualified with the worksheet name (`ForecastModel!J3:J5`).
 *
 * The same text is what the dialog shows, what the server stores and what a
 * formula resolves, so saving and re-reading a name never rewrites it.
 */

import { cellName, regionFromArea } from "./grid";
import type { NamedRange } from "./types";

/** Shown when a submitted name does not start with a letter. */
export const NAMED_RANGE_NAME_MESSAGE = "Named range must start with a letter";
/** Shown when the submitted range is not an A1 area. */
export const INVALID_NAMED_RANGE_MESSAGE = "Enter a valid cell range";

/** A named range resolved to its worksheet qualifier and its A1 rectangle. */
export interface NamedRangeTarget {
  /** Worksheet name qualifier, or `null` when the range has none. */
  sheet: string | null;
  start: string;
  end: string;
}

const NAME_PATTERN = /^[A-Za-z]/;

/** Error message of a submitted name, or `null` when it starts with a letter. */
export function namedRangeNameError(name: string): string | null {
  return NAME_PATTERN.test(String(name ?? "").trim()) ? null : NAMED_RANGE_NAME_MESSAGE;
}

/** Canonical range text `Sheet!A1:B2`, or `null` when the area is malformed. */
export function normalizeNamedRangeText(range: string): string | null {
  const target = parseNamedRangeTarget(range);
  if (!target) return null;
  const area = target.start === target.end ? target.start : `${target.start}:${target.end}`;
  return target.sheet ? `${target.sheet}!${area}` : area;
}

/** Parses `Sheet!A1:B2` / `A1:B2` into its qualifier and canonically ordered area. */
export function parseNamedRangeTarget(range: string): NamedRangeTarget | null {
  const text = String(range ?? "").trim();
  const bang = text.indexOf("!");
  const sheet = bang === -1 ? "" : text.slice(0, bang).trim();
  if (bang !== -1 && !sheet) return null;
  const bounds = regionFromArea(bang === -1 ? text : text.slice(bang + 1));
  if (!bounds) return null;
  return {
    sheet: sheet || null,
    start: cellName(bounds.top, bounds.left),
    end: cellName(bounds.bottom, bounds.right),
  };
}

/**
 * Named ranges keyed by their lowercased name, so a formula resolves a name
 * without regard to letter case (the stored name keeps its own spelling).
 */
export function namedRangeTargets(namedRanges: readonly NamedRange[] | undefined): Map<string, NamedRangeTarget> {
  const targets = new Map<string, NamedRangeTarget>();
  for (const entry of namedRanges ?? []) {
    const name = String(entry?.name ?? "").trim();
    const target = parseNamedRangeTarget(entry?.range ?? "");
    if (!name || !target) continue;
    targets.set(name.toLowerCase(), target);
  }
  return targets;
}

/** Cells of every worksheet by display name, used by a sheet-qualified name. */
export function sheetCellMaps(worksheets: readonly { name: string; cells: Record<string, string> }[]) {
  const sheets: Record<string, Record<string, string>> = {};
  for (const worksheet of worksheets) sheets[worksheet.name] = worksheet.cells;
  return sheets;
}

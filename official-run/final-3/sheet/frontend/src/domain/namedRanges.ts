/**
 * Workbook named ranges on the editor side.
 *
 * A saved name is stored as `{ name, worksheetId, range }`: the worksheet is
 * kept by stable id while the dialog shows the name the worksheet has today, so
 * the `Range` field of an edit reads like `ForecastModel!K2:K3`. The formula
 * engine reads saved names through the lookup built here, which resolves a bare
 * name to the coordinates of its area plus the cells of its worksheet.
 */

import { cellName, regionFromArea } from "./grid";
import type { NamedRangeLookup } from "./formula";
import type { NamedRange, Workbook } from "./types";

/** Message shown when a name does not start with a letter. */
export const NAMED_RANGE_NAME_MESSAGE = "Named range must start with a letter";
/** Message shown when the `Range` field is not a usable A1 area. */
export const INVALID_NAMED_RANGE_RANGE_MESSAGE = "Enter a range like Sheet1!A1:B2";

/** Reason `name` cannot be saved, or `null` when it can. */
export function namedRangeNameError(name: string): string | null {
  return /^[A-Za-z]/.test(String(name ?? "").trim()) ? null : NAMED_RANGE_NAME_MESSAGE;
}

/** `Sheet!A1:B2` display text of a saved named range. */
export function namedRangeText(namedRange: NamedRange, workbook: Workbook): string {
  const worksheet = workbook.worksheets.find((candidate) => candidate.id === namedRange.worksheetId);
  return worksheet ? `${worksheet.name}!${namedRange.range}` : namedRange.range;
}

/** The named range currently saved under `name`, ignoring letter case. */
export function findNamedRange(namedRanges: NamedRange[] | undefined, name: string): NamedRange | null {
  const lower = String(name ?? "").trim().toLowerCase();
  return (namedRanges ?? []).find((entry) => entry.name.toLowerCase() === lower) ?? null;
}

/**
 * Parses the `Range` field of the dialog: an A1 area, optionally qualified with
 * a worksheet name (`ForecastModel!J3:J5`). An unqualified area belongs to the
 * worksheet the editor is showing; an unknown worksheet name is rejected.
 */
export function parseNamedRangeRange(
  text: string,
  workbook: Workbook,
  activeWorksheetId: string,
): { worksheetId: string; range: string } | null {
  const raw = String(text ?? "").trim();
  const separator = raw.lastIndexOf("!");
  const sheetName = separator >= 0 ? raw.slice(0, separator).trim() : "";
  const areaText = separator >= 0 ? raw.slice(separator + 1).trim() : raw;
  const region = regionFromArea(areaText);
  if (!region) return null;
  let worksheetId = activeWorksheetId;
  if (sheetName !== "") {
    const worksheet = workbook.worksheets.find((candidate) => candidate.name.toLowerCase() === sheetName.toLowerCase());
    if (!worksheet) return null;
    worksheetId = worksheet.id;
  }
  const start = cellName(region.top, region.left);
  const end = cellName(region.bottom, region.right);
  return { worksheetId, range: start === end ? start : `${start}:${end}` };
}

/** Coordinates of an A1 area in row-major order, or an empty list. */
export function areaCoordinates(range: string): string[] {
  const region = regionFromArea(range);
  if (!region) return [];
  const coordinates: string[] = [];
  for (let row = region.top; row <= region.bottom; row += 1) {
    for (let column = region.left; column <= region.right; column += 1) {
      coordinates.push(cellName(row, column));
    }
  }
  return coordinates;
}

/**
 * Lookup the formula engine uses: a saved name resolves to the coordinates of
 * its area plus the cells of the worksheet the area lives on, so a name may be
 * read from any sheet of the workbook. Names are matched ignoring case.
 */
export function namedRangeLookup(workbook: Workbook): NamedRangeLookup {
  const byName = new Map<string, NamedRange>();
  for (const entry of workbook.namedRanges ?? []) byName.set(entry.name.toUpperCase(), entry);
  return (name) => {
    const entry = byName.get(String(name ?? "").toUpperCase());
    if (!entry) return null;
    const worksheet = workbook.worksheets.find((candidate) => candidate.id === entry.worksheetId);
    if (!worksheet) return null;
    return { coordinates: areaCoordinates(entry.range), cells: worksheet.cells };
  };
}

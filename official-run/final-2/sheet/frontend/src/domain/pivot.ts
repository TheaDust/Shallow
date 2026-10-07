/**
 * Pivot-table helpers for the workbook editor.
 *
 * The summary itself is derived and stored by the server (the authoritative
 * boundary); the editor only needs to describe a stored pivot table: which
 * source headers the field combo boxes offer and whether a configured field has
 * disappeared from the source range. Header texts are read from the raw source
 * cells, exactly like the server resolves them, so both agree on a field.
 */

import { cellName, regionFromArea } from "./grid";
import type { SummarizeMethod, Worksheet, WorksheetPivot } from "./types";

/** Options of the "Summarize by" combo box, in display order. */
export const SUMMARIZE_OPTIONS: ReadonlyArray<{ value: SummarizeMethod; label: string }> = [
  { value: "SUM", label: "SUM" },
  { value: "COUNT", label: "COUNT" },
  { value: "AVERAGE", label: "AVERAGE" },
];

/** Value of the "Columns" combo box that selects no column field. */
export const NO_COLUMN_FIELD = "";

/** Visible label of the "no column field" choice. */
export const NO_COLUMN_FIELD_LABEL = "(None)";

export const PIVOT_FIELD_MISSING_MESSAGE = "Pivot field is no longer available. Select a new field.";

/** Header texts of the source range's first row, in column order. */
export function pivotFieldOptions(source: Worksheet | undefined, range: string): string[] {
  if (!source) return [];
  const bounds = regionFromArea(range);
  if (!bounds) return [];
  const headers: string[] = [];
  for (let column = bounds.left; column <= bounds.right; column += 1) {
    const header = source.cells[cellName(bounds.top, column)] ?? "";
    if (header !== "") headers.push(header);
  }
  return headers;
}

/** Visible error when a configured field is no longer a header of the source range. */
export function pivotFieldError(pivot: WorksheetPivot, headers: string[]): string | null {
  const missing =
    !headers.includes(pivot.rowField) ||
    !headers.includes(pivot.valueField) ||
    (pivot.columnField !== NO_COLUMN_FIELD && !headers.includes(pivot.columnField));
  return missing ? PIVOT_FIELD_MISSING_MESSAGE : null;
}

/** Editable copy of a stored pivot's field layout. */
export function pivotConfigOf(pivot: WorksheetPivot) {
  return {
    rowField: pivot.rowField,
    columnField: pivot.columnField,
    valueField: pivot.valueField,
    summarizeBy: pivot.summarizeBy,
  };
}

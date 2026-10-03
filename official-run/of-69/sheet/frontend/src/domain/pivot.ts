import { parseRange } from "./filter";
import {
  cellDisplayText,
  cellName,
  columnLabel,
  type PivotMethod,
  type Workbook,
  type Worksheet,
} from "./types";

/**
 * Pivot tables of the workbook (REQ-5-3-1), mirroring `backend/src/lib/pivot.mjs`. A pivot
 * worksheet reads one source range and holds the last successful summary; fields are
 * identified by their source header text.
 */
export const PIVOT_METHODS: readonly PivotMethod[] = ["SUM", "COUNT", "AVERAGE"];

/** Label of the final summary row/column of every pivot. */
export const PIVOT_GRAND_TOTAL_LABEL = "Grand Total";

/** Label of the "Columns" option that leaves the column field unset. */
export const PIVOT_NO_COLUMN_LABEL = "None";

/** Shown when a stored field is no longer a header of the source range. */
export const PIVOT_FIELD_MISSING_MESSAGE = "Pivot field is no longer available. Select a new field.";

export interface PivotFieldOption {
  /** Absolute 0-based worksheet column of the source range. */
  column: number;
  /** Accessible name of the option: the header text, or the column letter when blank. */
  name: string;
}

/** One option per column of the source range, in range order (see the backend mirror). */
export function pivotFieldOptions(worksheet: Worksheet | null | undefined, range: string): PivotFieldOption[] {
  const bounds = parseRange(range);
  if (!bounds || !worksheet) return [];
  const options: PivotFieldOption[] = [];
  for (let column = bounds.left; column <= bounds.right; column += 1) {
    const header = cellDisplayText(worksheet, cellName(bounds.top, column)).trim();
    options.push({ column, name: header !== "" ? header : columnLabel(column) });
  }
  return options;
}

export function isPivotWorksheet(worksheet: Worksheet | null | undefined): boolean {
  return Boolean(worksheet?.pivot);
}

/** The worksheet a pivot reads, or `null` when it is not part of this workbook. */
export function pivotSourceWorksheet(
  workbook: Workbook,
  worksheet: Worksheet | null | undefined,
): Worksheet | null {
  const pivot = worksheet?.pivot;
  if (!pivot) return null;
  return workbook.worksheets.find((candidate) => candidate.id === pivot.sourceWorksheetId) ?? null;
}

/**
 * Field names of a pivot that are not headers of its current source range: the editor
 * shows the visible "select a new field" error while this list is not empty.
 */
export function unavailablePivotFields(
  workbook: Workbook,
  worksheet: Worksheet | null | undefined,
): string[] {
  const pivot = worksheet?.pivot;
  if (!pivot) return [];
  const source = pivotSourceWorksheet(workbook, worksheet);
  const names = source ? pivotFieldOptions(source, pivot.sourceRange).map((option) => option.name) : [];
  return [pivot.rowField, pivot.columnField, pivot.valueField]
    .filter((field): field is string => typeof field === "string" && field !== "")
    .filter((field, index, all) => all.indexOf(field) === index)
    .filter((field) => !names.includes(field));
}

/** Option list of one field combo box: the source headers plus an optional "None" entry. */
export function pivotFieldComboboxOptions(
  source: Worksheet | null,
  sourceRange: string,
  includeNone: boolean,
): Array<{ value: string; label: string }> {
  const options = pivotFieldOptions(source, sourceRange).map((option) => ({
    value: option.name,
    label: option.name,
  }));
  return includeNone ? [{ value: "", label: PIVOT_NO_COLUMN_LABEL }, ...options] : options;
}

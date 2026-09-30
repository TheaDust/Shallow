import { makeCellId, type CellRegion } from "../lib/cells";
import { displayedCellText } from "../workbooks/cells";
import type { PivotData, PivotFieldInput, PivotSummary, WorksheetData } from "../workbooks/types";

/**
 * Pure logic of the pivot table editor (REQ-5-3-1): the source headers a field can be selected from,
 * the state the combo boxes start with and the fields a stored configuration can no longer resolve.
 * The summary itself is computed by the server, so this module never reads source values.
 */

export const PIVOT_SUMMARIES: readonly PivotSummary[] = ["SUM", "COUNT", "AVERAGE"];
export const NO_FIELD_VALUE = "";
export const NO_FIELD_LABEL = "(none)";
export const MISSING_PIVOT_FIELD_MESSAGE = "Pivot field is no longer available. Select a new field.";
export const MISSING_PIVOT_SELECTION_MESSAGE = "Select the row field and the value field of the pivot table.";
export const MISSING_PIVOT_SOURCE_MESSAGE = "The pivot source range is no longer available.";
export const NUMERIC_VALUE_FIELD_MESSAGE = "Value field requires numeric values";
export const NOT_A_PIVOT_MESSAGE = "This worksheet is not a pivot table.";
export const PIVOT_REGION_MESSAGE = "Select a range with a header row to create a pivot table.";

/** Header texts of the source range of a pivot, in range order and without blank headers. */
export function pivotHeaders(source: WorksheetData | null | undefined, range: CellRegion): string[] {
  if (!source) return [];
  const headers: string[] = [];
  for (let column = range.left; column <= range.right; column += 1) {
    const text = displayedCellText(source, makeCellId(range.top, column));
    if (text.trim() !== "" && !headers.includes(text)) headers.push(text);
  }
  return headers;
}

/** What the combo boxes of the editor show: a header text, or the empty value for "(none)". */
export interface PivotFieldSelection {
  rows: string;
  columns: string;
  values: string;
  summarizeBy: PivotSummary;
}

/** Field values of the editor: the stored selection, or the empty (none) option of a fresh pivot. */
export function pivotFieldsOf(pivot: PivotData): PivotFieldSelection {
  return {
    rows: pivot.rows ?? NO_FIELD_VALUE,
    columns: pivot.columns ?? NO_FIELD_VALUE,
    values: pivot.values ?? NO_FIELD_VALUE,
    summarizeBy: pivot.summarizeBy,
  };
}

/**
 * Selected fields whose header no longer exists in the source range. A stored field that is missing
 * requires the user to select a new one, so the last successful result stays visible meanwhile.
 */
export function missingPivotFields(pivot: PivotData, headers: readonly string[]): string[] {
  return [pivot.rows, pivot.values, pivot.columns].filter(
    (field): field is string => typeof field === "string" && field !== "" && !headers.includes(field),
  );
}

/** The payload of one `Apply`: an unused combo box means "no field". */
export function pivotFieldInput(fields: PivotFieldSelection): PivotFieldInput {
  const field = (value: string) => (value === NO_FIELD_VALUE ? null : value);
  return {
    rows: field(fields.rows),
    columns: field(fields.columns),
    values: field(fields.values),
    summarizeBy: fields.summarizeBy,
  };
}

import { cellCoordinate, normalizeRange, type CellRange } from "./spreadsheet";

/**
 * Basic pivot summarization (REQ-5-3-1). The *computation* lives on the server, which writes the
 * result into the pivot worksheet's cells; this module holds the shared vocabulary of the editor:
 * the configuration shape, the field options of the source range and the labels/messages the UI
 * shows.
 */

export type SummarizeMethod = "SUM" | "COUNT" | "AVERAGE";

/** Order of the `Summarize by` options. */
export const SUMMARIZE_METHODS: readonly SummarizeMethod[] = ["SUM", "COUNT", "AVERAGE"];

/** Option value of the optional `Columns` combo when no column field is selected. */
export const NO_PIVOT_FIELD = "";

/** Visible name of that option. */
export const NO_PIVOT_FIELD_LABEL = "None";

export const PIVOT_FIELD_UNAVAILABLE_MESSAGE = "Pivot field is no longer available. Select a new field.";
export const PIVOT_FIELDS_REQUIRED_MESSAGE = "Select a row field and a value field";
export const PIVOT_SOURCE_MESSAGE = "Select a data region with headers to create a pivot table";

/**
 * Pivot configuration stored on the pivot worksheet. Fields are the header texts of the source
 * range, so a moved column keeps its field; `columns` is the optional column field and
 * `summarizeBy` is the summarization method.
 */
export interface PivotConfig {
  source: { worksheetId: string; range: CellRange };
  rows: string | null;
  columns: string | null;
  values: string | null;
  summarizeBy: SummarizeMethod;
}

/** The four settings the `Pivot table editor` sends with `Apply`. */
export interface PivotSettings {
  rows: string;
  columns: string | null;
  values: string;
  summarizeBy: SummarizeMethod;
}

/** Header text of the value column: `<summarization method> of <value field>`. */
export function summaryHeader(method: SummarizeMethod, valueField: string): string {
  return `${method} of ${valueField}`;
}

/** Header texts of the first row of the source range, in column order (empty headers dropped). */
export function pivotSourceFields(cells: Record<string, string>, range: CellRange): string[] {
  const bounds = normalizeRange({ anchor: range.start, focus: range.end });
  const fields: string[] = [];
  for (let column = bounds.minColumn; column <= bounds.maxColumn; column += 1) {
    const text = (cells[cellCoordinate(bounds.minRow, column)] ?? "").trim();
    if (text !== "") fields.push(text);
  }
  return fields;
}

/**
 * Visible error of a pivot configuration whose source no longer offers one of its fields. The
 * message is derived from the current source headers, so opening the editor after the source
 * changed reports the missing field without a request.
 */
export function pivotFieldProblem(pivot: PivotConfig | null, fields: readonly string[]): string | null {
  if (!pivot) return null;
  for (const field of [pivot.rows, pivot.values, pivot.columns]) {
    if (field !== null && !fields.includes(field)) return PIVOT_FIELD_UNAVAILABLE_MESSAGE;
  }
  return null;
}

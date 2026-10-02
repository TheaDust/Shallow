import { parseRangeText } from "./filter";
import { displayValues } from "./formula";
import { cellName, type PivotSummarize, type PivotTable, type Worksheet } from "./workbook";

/**
 * Pivot-table helpers of the editor (REQ-5-3-1).
 *
 * The summary itself is computed and stored by the server, so the client only
 * derives what the "Pivot table editor" needs: the header names of the source
 * range (the accessible names of the `Rows`/`Columns`/`Values` options) and the
 * fields of the stored configuration that no longer exist in that source.
 */

/** Visible names of the summarization methods, in the order the combo lists them. */
export const SUMMARIZE_METHODS: readonly PivotSummarize[] = ["SUM", "COUNT", "AVERAGE"];

/** Header texts of a pivot source range, in column order (empty ones dropped). */
export function pivotHeaderOptions(source: Worksheet | undefined, sourceRange: string): string[] {
  const region = source ? parseRangeText(sourceRange) : null;
  if (!source || !region) return [];
  const display = displayValues(source);
  const headers: string[] = [];
  for (let col = region.minCol; col <= region.maxCol; col += 1) {
    const header = (display[cellName({ row: region.minRow, col })] ?? "").trim();
    if (header && !headers.includes(header)) headers.push(header);
  }
  return headers;
}

/**
 * Configured fields that the current source headers no longer provide (a deleted
 * header, a moved region). An empty list means every field still resolves.
 */
export function pivotMissingFields(pivot: PivotTable, headers: readonly string[]): string[] {
  const missing: string[] = [];
  if (pivot.rowField && !headers.includes(pivot.rowField)) missing.push(pivot.rowField);
  if (pivot.columnField && !headers.includes(pivot.columnField)) missing.push(pivot.columnField);
  if (pivot.valueField && !headers.includes(pivot.valueField)) missing.push(pivot.valueField);
  return missing;
}

/**
 * Fields the editor starts from when the pivot has not been configured yet: the
 * first two headers give a ready-to-apply layout without changing stored state.
 */
export function defaultPivotFields(headers: readonly string[]): { rowField: string; valueField: string } {
  return { rowField: headers[0] ?? "", valueField: headers[1] ?? headers[0] ?? "" };
}

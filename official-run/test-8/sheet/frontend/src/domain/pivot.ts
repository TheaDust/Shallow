import { cellCoordinate, columnLabel } from "./grid";
import type { CellRange, PivotSummarizeMethod, PivotTable, Worksheet } from "./types";

/**
 * Pivot summarization shared by the pivot editor and the test mock backend.
 *
 * The pivot only reads the source worksheet: it locates the stored fields by
 * their header text, walks the data rows in source order (skipping blank rows)
 * and derives the result cells. The server owns the same computation, so the
 * UI, the mock and the persisted result agree.
 */

/** Summarization methods offered by the pivot "Summarize by" combo box. */
export const PIVOT_SUMMARIZE_METHODS: readonly PivotSummarizeMethod[] = ["SUM", "COUNT", "AVERAGE"];

/** "Summarize by" options in their visible order. */
export const PIVOT_SUMMARIZE_OPTIONS: ReadonlyArray<{ value: PivotSummarizeMethod; label: string }> = [
  { value: "SUM", label: "SUM" },
  { value: "COUNT", label: "COUNT" },
  { value: "AVERAGE", label: "AVERAGE" },
];

/** Shown when a configured source header can no longer be located. */
export const PIVOT_FIELD_MISSING = "Pivot field is no longer available. Select a new field.";

/** Shown when SUM/AVERAGE has no parseable number in the value field. */
export const PIVOT_NUMERIC_REQUIRED = "Value field requires numeric values";

/** Option value used by the optional "Columns" combo box when no field is chosen. */
export const PIVOT_NO_COLUMN_FIELD = "";

/** Visible name of the "no column field" option. */
export const PIVOT_NO_COLUMN_LABEL = "(None)";

/** A1-style label of a rectangle, for example `A1:C6`. */
export function rangeLabel(range: CellRange): string {
  const start = `${columnLabel(range.minCol)}${range.minRow + 1}`;
  const end = `${columnLabel(range.maxCol)}${range.maxRow + 1}`;
  return start === end ? start : `${start}:${end}`;
}

function textAt(cells: Record<string, string>, row: number, col: number): string {
  const value = cells[cellCoordinate(row, col)];
  return value === undefined || value === null ? "" : value;
}

/**
 * Source columns that can act as pivot fields: the columns of the range whose
 * header cell (its first row) carries a non-empty display name. Duplicate
 * header text is offered once.
 */
export function pivotHeaderFields(worksheet: Worksheet, range: CellRange): Array<{ col: number; name: string }> {
  const fields: Array<{ col: number; name: string }> = [];
  if (!range) return fields;
  const seen = new Set<string>();
  for (let col = range.minCol; col <= range.maxCol; col += 1) {
    const name = textAt(worksheet.cells, range.minRow, col).trim();
    if (name === "" || seen.has(name)) continue;
    seen.add(name);
    fields.push({ col, name });
  }
  return fields;
}

/** Options for the Rows/Columns/Values combo boxes, named by the source header text. */
export function pivotFieldOptions(
  worksheet: Worksheet,
  range: CellRange,
): Array<{ value: string; label: string }> {
  return pivotHeaderFields(worksheet, range).map((field) => ({ value: field.name, label: field.name }));
}

/** Column index of a source header by its exact text, or -1 when it moved away. */
function headerColumn(worksheet: Worksheet, range: CellRange, name: string): number {
  if (typeof name !== "string" || name === "") return -1;
  for (let col = range.minCol; col <= range.maxCol; col += 1) {
    if (textAt(worksheet.cells, range.minRow, col).trim() === name) return col;
  }
  return -1;
}

function isNumericText(text: string): boolean {
  if (text.trim() === "") return false;
  return Number.isFinite(Number(text));
}

interface PivotRecord {
  row: string;
  column: string;
  value: string;
}

function aggregate(records: PivotRecord[], method: PivotSummarizeMethod): number {
  if (method === "COUNT") return records.filter((record) => record.value.trim() !== "").length;
  const numbers = records
    .filter((record) => isNumericText(record.value))
    .map((record) => Number(record.value));
  if (numbers.length === 0) return 0;
  const sum = numbers.reduce((total, value) => total + value, 0);
  return method === "AVERAGE" ? sum / numbers.length : sum;
}

export type PivotComputation =
  | { ok: true; cells: Record<string, string> }
  | { ok: false; error: string };

/** Summarizes a source range into the cells of a pivot result worksheet. */
export function computePivot(worksheet: Worksheet, pivot: PivotTable): PivotComputation {
  const range = pivot?.sourceRange;
  if (!range) return { ok: false, error: PIVOT_FIELD_MISSING };
  const rowCol = headerColumn(worksheet, range, pivot.rowField);
  const valueCol = headerColumn(worksheet, range, pivot.valueField);
  const hasColumnField = typeof pivot.columnField === "string" && pivot.columnField !== "";
  const columnCol = hasColumnField ? headerColumn(worksheet, range, pivot.columnField as string) : -1;
  if (rowCol < 0 || valueCol < 0 || (hasColumnField && columnCol < 0)) {
    return { ok: false, error: PIVOT_FIELD_MISSING };
  }

  const records: PivotRecord[] = [];
  for (let row = range.minRow + 1; row <= range.maxRow; row += 1) {
    let hasContent = false;
    for (let col = range.minCol; col <= range.maxCol; col += 1) {
      if (textAt(worksheet.cells, row, col).trim() !== "") {
        hasContent = true;
        break;
      }
    }
    if (!hasContent) continue;
    records.push({
      row: textAt(worksheet.cells, row, rowCol),
      column: hasColumnField ? textAt(worksheet.cells, row, columnCol) : "",
      value: textAt(worksheet.cells, row, valueCol),
    });
  }

  const method: PivotSummarizeMethod = PIVOT_SUMMARIZE_METHODS.includes(pivot.summarizeBy)
    ? pivot.summarizeBy
    : "SUM";
  if (method !== "COUNT" && !records.some((record) => isNumericText(record.value))) {
    return { ok: false, error: PIVOT_NUMERIC_REQUIRED };
  }

  const rowValues: string[] = [];
  const columnValues: string[] = [];
  for (const record of records) {
    if (!rowValues.includes(record.row)) rowValues.push(record.row);
    if (hasColumnField && !columnValues.includes(record.column)) columnValues.push(record.column);
  }
  const matchingRow = (rowValue: string) => records.filter((record) => record.row === rowValue);
  const matchingColumn = (columnValue: string) =>
    records.filter((record) => record.column === columnValue);
  const matchingCell = (rowValue: string, columnValue: string) =>
    records.filter((record) => record.row === rowValue && record.column === columnValue);

  const cells: Record<string, string> = {};
  const put = (row: number, col: number, value: string | number) => {
    cells[cellCoordinate(row, col)] = String(value);
  };

  put(0, 0, pivot.rowField);
  if (!hasColumnField) {
    put(0, 1, `${method} of ${pivot.valueField}`);
    rowValues.forEach((rowValue, index) => {
      put(index + 1, 0, rowValue);
      put(index + 1, 1, aggregate(matchingRow(rowValue), method));
    });
    const totalRow = rowValues.length + 1;
    put(totalRow, 0, "Grand Total");
    put(totalRow, 1, aggregate(records, method));
    return { ok: true, cells };
  }

  columnValues.forEach((columnValue, index) => put(0, index + 1, columnValue));
  const totalCol = columnValues.length + 1;
  put(0, totalCol, "Grand Total");
  rowValues.forEach((rowValue, index) => {
    const row = index + 1;
    put(row, 0, rowValue);
    columnValues.forEach((columnValue, colIndex) => {
      put(row, colIndex + 1, aggregate(matchingCell(rowValue, columnValue), method));
    });
    put(row, totalCol, aggregate(matchingRow(rowValue), method));
  });
  const totalRow = rowValues.length + 1;
  put(totalRow, 0, "Grand Total");
  columnValues.forEach((columnValue, colIndex) => {
    put(totalRow, colIndex + 1, aggregate(matchingColumn(columnValue), method));
  });
  put(totalRow, totalCol, aggregate(records, method));
  return { ok: true, cells };
}

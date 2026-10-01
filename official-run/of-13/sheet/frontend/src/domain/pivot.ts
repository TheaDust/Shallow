/**
 * Pivot-table helpers shared by the editor region, the create dialog and the test double.
 *
 * The authoritative summary lives in `backend/src/domain/pivot.mjs`: the server computes the
 * summary and stores it as the pivot worksheet's cells, so the editor only renders what it
 * receives. These helpers derive the field options the editor shows (the header text of the
 * source range) and mirror the computation so the test double answers like the real server.
 */

import { filterRangeBounds } from "./filter";
import { cellAddress } from "./spreadsheet";
import {
  cellText,
  type PivotConfig,
  type PivotMethod,
  type WorkbookState,
  type WorksheetState,
} from "./workbook";

/** Contract messages of a refused pivot operation, mirroring `backend/src/domain/pivot.mjs`. */
export const PIVOT_FIELD_MISSING_MESSAGE = "Pivot field is no longer available. Select a new field.";
export const PIVOT_NUMERIC_MESSAGE = "Value field requires numeric values";
export const GRAND_TOTAL_LABEL = "Grand Total";

/** Options of the `Summarize by` combo box, in the order the editor lists them. */
export const PIVOT_METHODS: readonly PivotMethod[] = ["SUM", "COUNT", "AVERAGE"];

/** Value of the `Columns` combo box when the pivot has no column field. */
export const NO_PIVOT_FIELD = "";

/** The worksheet a pivot config reads its source data from. */
export function pivotSourceSheet(
  workbook: WorkbookState | null,
  pivot: PivotConfig | undefined,
): WorksheetState | undefined {
  return workbook?.sheets.find((sheet) => sheet.id === pivot?.sourceSheetId);
}

/**
 * Header texts of the pivot source range, left to right, duplicates and blanks dropped: they
 * are the accessible names of the `Rows`, `Columns` and `Values` options.
 */
export function pivotFieldOptions(
  workbook: WorkbookState | null,
  pivot: PivotConfig | undefined,
): string[] {
  const bounds = filterRangeBounds(pivot?.sourceRange);
  const source = pivotSourceSheet(workbook, pivot);
  if (!bounds || !source) return [];
  const fields: string[] = [];
  for (let column = bounds.left; column <= bounds.right; column += 1) {
    // `filterRangeBounds` is 0-based, like every grid helper.
    const text = cellText(source, cellAddress(bounds.top, column)).trim();
    if (text !== "" && !fields.includes(text)) fields.push(text);
  }
  return fields;
}

/** A parseable number, or null for an empty or nonnumeric value field entry. */
function parseNumber(text: string): number | null {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Same rounding as the server's `formatNumber` (no floating-point noise). */
function formatNumber(value: number): string {
  return String(Number(value.toPrecision(12)));
}

/**
 * Mirror of the server's summary computation: it makes the test double and any local preview
 * answer exactly like `backend/src/domain/pivot.mjs`.
 */
export function computePivotCells(
  source: WorksheetState | undefined,
  config: PivotConfig,
): { ok: true; cells: Record<string, string> } | { ok: false; error: string } {
  const bounds = filterRangeBounds(config.sourceRange);
  if (!source || !bounds) return { ok: false, error: "Invalid pivot source range" };
  /** 0-based reader of one displayed header or data value. */
  const text = (row: number, column: number) => cellText(source, cellAddress(row, column)).trim();

  const columnOfField = (field: string): number => {
    if (!field) return -1;
    for (let column = bounds.left; column <= bounds.right; column += 1) {
      if (text(bounds.top, column) === field) return column;
    }
    return -1;
  };

  const rowColumn = columnOfField(config.rowField);
  const valueColumn = columnOfField(config.valueField);
  const columnColumn = config.columnField ? columnOfField(config.columnField) : -1;
  if (rowColumn < 0 || valueColumn < 0 || (config.columnField && columnColumn < 0)) {
    return { ok: false, error: PIVOT_FIELD_MISSING_MESSAGE };
  }

  const records: Array<{ rowName: string; valueText: string; columnName: string }> = [];
  for (let row = bounds.top + 1; row <= bounds.bottom; row += 1) {
    const rowName = text(row, rowColumn);
    const valueText = text(row, valueColumn);
    const columnName = columnColumn > 0 ? text(row, columnColumn) : "";
    if (rowName === "" && valueText === "" && columnName === "") continue;
    records.push({ rowName, valueText, columnName });
  }

  if (config.method !== "COUNT" && !records.some((record) => parseNumber(record.valueText) !== null)) {
    return { ok: false, error: PIVOT_NUMERIC_MESSAGE };
  }

  const aggregate = (entries: string[]): string => {
    if (config.method === "COUNT") return String(entries.filter((entry) => entry !== "").length);
    const numbers = entries.map(parseNumber).filter((entry): entry is number => entry !== null);
    const total = numbers.reduce((sum, entry) => sum + entry, 0);
    if (config.method === "AVERAGE") return formatNumber(numbers.length ? total / numbers.length : 0);
    return formatNumber(total);
  };
  const valuesOf = (entries: typeof records) => entries.map((entry) => entry.valueText);

  const rowNames: string[] = [];
  const columnNames: string[] = [];
  for (const record of records) {
    if (!rowNames.includes(record.rowName)) rowNames.push(record.rowName);
    if (columnColumn > 0 && !columnNames.includes(record.columnName)) columnNames.push(record.columnName);
  }

  const cells: Record<string, string> = { A1: config.rowField };
  if (columnColumn < 0) {
    cells.B1 = `${config.method} of ${config.valueField}`;
    rowNames.forEach((name, index) => {
      const row = index + 2;
      cells[`A${row}`] = name;
      cells[`B${row}`] = aggregate(valuesOf(records.filter((record) => record.rowName === name)));
    });
    const totalRow = rowNames.length + 2;
    cells[`A${totalRow}`] = GRAND_TOTAL_LABEL;
    cells[`B${totalRow}`] = aggregate(valuesOf(records));
    return { ok: true, cells };
  }

  columnNames.forEach((name, index) => {
    cells[cellAddress(0, index + 1)] = name;
  });
  const totalColumn = columnNames.length + 1;
  cells[cellAddress(0, totalColumn)] = GRAND_TOTAL_LABEL;
  rowNames.forEach((name, index) => {
    const row = index + 1;
    const inRow = records.filter((record) => record.rowName === name);
    cells[cellAddress(row, 0)] = name;
    columnNames.forEach((columnName, columnIndex) => {
      cells[cellAddress(row, columnIndex + 1)] = aggregate(
        valuesOf(inRow.filter((record) => record.columnName === columnName)),
      );
    });
    cells[cellAddress(row, totalColumn)] = aggregate(valuesOf(inRow));
  });
  const totalRow = rowNames.length + 1;
  cells[cellAddress(totalRow, 0)] = GRAND_TOTAL_LABEL;
  columnNames.forEach((columnName, columnIndex) => {
    cells[cellAddress(totalRow, columnIndex + 1)] = aggregate(
      valuesOf(records.filter((record) => record.columnName === columnName)),
    );
  });
  cells[cellAddress(totalRow, totalColumn)] = aggregate(valuesOf(records));
  return { ok: true, cells };
}

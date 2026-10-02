/** CSV serialization for the active worksheet, independent of React. */

import { cellAddress, parseAddress } from "./spreadsheet";
import { cellText, type WorksheetState } from "./workbook";

export interface UsedRange {
  /** Number of rows from row 1 up to the last row that holds a value. */
  rowCount: number;
  /** Number of columns from column A up to the last column that holds a value. */
  columnCount: number;
}

/** Used range is the rectangular region from A1 to the last non-empty cell. */
export function worksheetUsedRange(sheet: WorksheetState | undefined): UsedRange {
  if (!sheet) return { rowCount: 0, columnCount: 0 };
  let rowCount = 0;
  let columnCount = 0;
  for (const [address, value] of Object.entries(sheet.cells)) {
    if (!value) continue;
    const position = parseAddress(address);
    if (!position) continue;
    rowCount = Math.max(rowCount, position.row + 1);
    columnCount = Math.max(columnCount, position.column + 1);
  }
  return { rowCount, columnCount };
}

/** Escapes a field only when it contains a comma, a quote or a line break. */
export function formatCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Serializes the worksheet in grid order. Empty cells inside the used range are kept,
 * and every cell contributes its displayed text (calculated result for formula cells).
 */
export function worksheetToCsv(sheet: WorksheetState | undefined): string {
  const { rowCount, columnCount } = worksheetUsedRange(sheet);
  if (rowCount === 0 || columnCount === 0) return "";
  const lines: string[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    const fields: string[] = [];
    for (let column = 0; column < columnCount; column += 1) {
      fields.push(formatCsvField(cellText(sheet, cellAddress(row, column))));
    }
    lines.push(fields.join(","));
  }
  return lines.join("\n");
}

/** Suggested download name: the workbook name with a single `.csv` suffix. */
export function csvFileName(workbookName: string): string {
  const base = workbookName.trim().replace(/[\\/:*?"<>|]/g, "_");
  return `${base || "worksheet"}.csv`;
}

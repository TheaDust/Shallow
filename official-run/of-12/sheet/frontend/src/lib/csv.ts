import { cellDisplayText, worksheetResults } from "./formula";
import { cellCoordinate, parseCellCoordinate } from "./spreadsheet";
import type { Worksheet } from "./workbooks";

/** Quotes a field when it contains a comma, a double quote or a line break (RFC 4180 style). */
export function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export interface UsedRange {
  rows: number;
  columns: number;
}

/** Number of rows/columns that actually hold content; empty cells inside them are still exported. */
export function worksheetUsedRange(cells: Record<string, string>): UsedRange {
  let rows = 0;
  let columns = 0;
  for (const [coordinate, value] of Object.entries(cells)) {
    if (!value) continue;
    const position = parseCellCoordinate(coordinate);
    if (!position) continue;
    rows = Math.max(rows, position.row + 1);
    columns = Math.max(columns, position.column + 1);
  }
  return { rows, columns };
}

/**
 * Serializes a worksheet to UTF-8 CSV text in the grid's own row and column order. Empty cells
 * inside the used range become empty fields; an entirely empty worksheet exports nothing. A cell
 * exports what the grid shows it as: an ordinary cell its own text, a formula cell the calculated
 * result (or error) of the expression it stores.
 */
export function worksheetToCsv(worksheet: Pick<Worksheet, "cells">): string {
  const { rows, columns } = worksheetUsedRange(worksheet.cells);
  if (rows === 0 || columns === 0) return "";
  const results = worksheetResults(worksheet.cells);
  const lines: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    const fields: string[] = [];
    for (let column = 0; column < columns; column += 1) {
      const coordinate = cellCoordinate(row, column);
      fields.push(escapeCsvField(cellDisplayText(worksheet.cells[coordinate], results[coordinate])));
    }
    lines.push(fields.join(","));
  }
  return lines.join("\n");
}

export function worksheetCsvFileName(workbookName: string, worksheetName: string): string {
  const base = `${workbookName} - ${worksheetName}`.replace(/[\\/]/g, "-").trim();
  return `${base || "worksheet"}.csv`;
}

/** Hands generated text to the browser as a download; nothing in the application state changes. */
export function downloadTextFile(fileName: string, text: string, mimeType = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

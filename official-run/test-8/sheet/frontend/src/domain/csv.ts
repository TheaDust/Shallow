import { cellCoordinate, indexRange } from "./grid";
import { evaluateCells } from "./formula";
import type { Worksheet } from "./types";

/** Message shown when the uploaded text is not valid CSV (mirrors the API). */
export const INVALID_CSV_MESSAGE = "Invalid CSV file format. Import failed.";

/**
 * RFC 4180-style CSV parsing used by the app (and by the test mock backend) so
 * import behaves the same in the browser and on the server. Returns the parsed
 * rows in their original order, or null when the text is not valid CSV.
 */
export function parseCsv(text: string): string[][] | null {
  if (typeof text !== "string") return null;
  // Files exported by spreadsheet tools often start with a UTF-8 BOM.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let recordStarted = false;
  let fieldStarted = false;

  const endField = () => {
    record.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRecord = () => {
    endField();
    rows.push(record);
    record = [];
    recordStarted = false;
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else if (character === "\r") {
        if (source[index + 1] === "\n") index += 1;
        field += "\n";
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && !fieldStarted && field.length === 0) {
      inQuotes = true;
      fieldStarted = true;
      recordStarted = true;
      continue;
    }

    if (character === ",") {
      endField();
      recordStarted = true;
      continue;
    }

    if (character === "\r" || character === "\n") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      if (recordStarted || fieldStarted || field.length > 0) endRecord();
      continue;
    }

    field += character;
    fieldStarted = true;
    recordStarted = true;
  }

  if (inQuotes) return null;
  if (recordStarted || fieldStarted || field.length > 0) endRecord();
  return rows;
}

/** Quotes a field only when it contains a comma, a quote or a line break. */
export function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serializes rows back into CSV text (UTF-8, `\n` line breaks). */
export function serializeCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(escapeCsvField).join(",")).join("\n");
}

/**
 * Used-range bounds of a worksheet: the rectangle covering the furthest
 * non-empty cell. Empty cells inside that rectangle are exported as empty
 * fields so the grid's row/column order is preserved.
 */
export function usedRange(worksheet: Worksheet) {
  const display = evaluateCells(worksheet.cells);
  let maxRow = -1;
  let maxCol = -1;
  for (const row of indexRange(worksheet.rowCount)) {
    for (const col of indexRange(worksheet.columnCount)) {
      if ((display[cellCoordinate(row, col)] ?? "").length > 0) {
        if (row > maxRow) maxRow = row;
        if (col > maxCol) maxCol = col;
      }
    }
  }
  return { rowCount: maxRow + 1, columnCount: maxCol + 1 };
}

/**
 * Exports one worksheet as CSV. Cells are written in grid row/column order and
 * hold their displayed value, so formula cells export their calculated result
 * rather than the formula expression.
 */
export function worksheetToCsv(worksheet: Worksheet): string {
  const { rowCount, columnCount } = usedRange(worksheet);
  const display = evaluateCells(worksheet.cells);
  const rows: string[][] = [];
  for (const row of indexRange(rowCount)) {
    const fields: string[] = [];
    for (const col of indexRange(columnCount)) {
      fields.push(display[cellCoordinate(row, col)] ?? "");
    }
    rows.push(fields);
  }
  return serializeCsv(rows);
}

/** Suggested download name: workbook and worksheet, always ending in `.csv`. */
export function csvFileName(workbookName: string, worksheetName: string): string {
  const safe = (value: string) => value.replace(/[\\/:*?"<>|]/g, "-").trim();
  return `${safe(workbookName)} - ${safe(worksheetName)}.csv`;
}

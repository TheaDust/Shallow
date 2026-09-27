import type { Sheet } from "./types";
import { cellCoordinate, columnNumber } from "./coords";
import { displayValue } from "./formula";

/**
 * CSV parsing for workbook import (backend semantics, mirrored for the frontend
 * test double). A field that begins with a double quote but has no closing
 * double quote is invalid CSV.
 */

export const INVALID_CSV_MESSAGE = "Invalid CSV file format. Import failed.";

export function parseCsv(input: string): { rows: string[][] } | { error: string } {
  let text = String(input ?? "");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let fieldStarted = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];
    if (ch === '"') {
      if (!fieldStarted) {
        i += 1;
        let closed = false;
        while (i < n) {
          if (text[i] === '"') {
            if (text[i + 1] === '"') {
              field += '"';
              i += 2;
            } else {
              closed = true;
              i += 1;
              break;
            }
          } else {
            field += text[i];
            i += 1;
          }
        }
        if (!closed) return { error: INVALID_CSV_MESSAGE };
        fieldStarted = true;
        if (i < n) {
          const c = text[i];
          if (c === ",") {
            row.push(field);
            field = "";
            fieldStarted = false;
            i += 1;
          } else if (c === "\n") {
            row.push(field);
            rows.push(row);
            field = "";
            fieldStarted = false;
            row = [];
            i += 1;
          } else if (c === "\r") {
            row.push(field);
            rows.push(row);
            field = "";
            fieldStarted = false;
            row = [];
            i += text[i + 1] === "\n" ? 2 : 1;
          } else {
            return { error: INVALID_CSV_MESSAGE };
          }
        } else {
          row.push(field);
          rows.push(row);
          field = "";
          fieldStarted = false;
          row = [];
        }
      } else {
        field += ch;
        i += 1;
      }
    } else if (ch === ",") {
      row.push(field);
      field = "";
      fieldStarted = false;
      i += 1;
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      field = "";
      fieldStarted = false;
      row = [];
      i += 1;
    } else if (ch === "\r") {
      row.push(field);
      rows.push(row);
      field = "";
      fieldStarted = false;
      row = [];
      i += text[i + 1] === "\n" ? 2 : 1;
    } else {
      field += ch;
      fieldStarted = true;
      i += 1;
    }
  }

  if (field !== "" || fieldStarted || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return { rows };
}

/** Rectangular used range of a sheet: declared dimensions or non-empty bounding box. */
export function usedRange(sheet: Sheet): { rows: number; columns: number } {
  if (sheet.rowCount != null && sheet.columnCount != null) {
    return { rows: sheet.rowCount, columns: sheet.columnCount };
  }
  let maxRow = 0;
  let maxCol = 0;
  for (const coord of Object.keys(sheet.cells)) {
    const m = coord.match(/^([A-Z]+)(\d+)$/);
    if (!m) continue;
    maxRow = Math.max(maxRow, Number(m[2]));
    maxCol = Math.max(maxCol, columnNumber(m[1]));
  }
  return { rows: maxRow, columns: maxCol };
}

function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toCsvText(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvField).join(",")).join("\n");
}

/**
 * Export the current active worksheet as CSV text: cells are emitted in the
 * grid's row/column order, empty cells inside the used range are preserved,
 * and text containing commas, quotes or line breaks is quoted/escaped.
 * Ordinary cells export their displayed values; formula cells export their
 * current calculated results rather than the formula expression (REQ-1-3-2).
 */
export function sheetToCsv(sheet: Sheet): string {
  const { rows, columns } = usedRange(sheet);
  const out: string[][] = [];
  for (let r = 0; r < rows; r += 1) {
    const row: string[] = [];
    for (let c = 0; c < columns; c += 1) {
      row.push(displayValue(sheet.cells[cellCoordinate(c, r)], sheet.cells));
    }
    out.push(row);
  }
  return toCsvText(out);
}

/** Start a browser download of CSV text with the given suggested file name. */
export function downloadCsv(fileName: string, csvText: string): void {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

import { makeCellId, parseCellId } from "../lib/cells";
import { displayedCellText } from "./cells";
import type { WorksheetData } from "./types";

interface UsedRange {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const UNSAFE_FILE_NAME = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * Text a cell contributes to the exported CSV: the value the grid displays, so a formula cell exports
 * its current calculated result.
 */
function exportedCellText(worksheet: WorksheetData, cellId: string): string {
  return displayedCellText(worksheet, cellId);
}

/**
 * Bounding box of every non-empty cell, i.e. the used range of the worksheet. Empty leading/trailing
 * rows and columns are outside the used range and are not exported; empty cells inside it are kept.
 */
function usedRange(worksheet: WorksheetData): UsedRange | null {
  let top = Number.POSITIVE_INFINITY;
  let bottom = 0;
  let left = Number.POSITIVE_INFINITY;
  let right = 0;
  for (const [cellId, cell] of Object.entries(worksheet.cells)) {
    if (cell?.value === undefined || cell.value === "") continue;
    const address = parseCellId(cellId);
    if (!address) continue;
    top = Math.min(top, address.row);
    bottom = Math.max(bottom, address.row);
    left = Math.min(left, address.column);
    right = Math.max(right, address.column);
  }
  return bottom === 0 ? null : { top, bottom, left, right };
}

/** Quotes and escapes a field that contains a comma, a quote or a line break (RFC 4180 style). */
export function escapeCsvField(text: string): string {
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * Serializes one worksheet as CSV in the grid's row/column order, keeping every empty cell that
 * falls inside the used range as an empty field.
 */
export function worksheetToCsv(worksheet: WorksheetData): string {
  const used = usedRange(worksheet);
  if (!used) return "";
  const lines: string[] = [];
  for (let row = used.top; row <= used.bottom; row += 1) {
    const fields: string[] = [];
    for (let column = used.left; column <= used.right; column += 1) {
      fields.push(escapeCsvField(exportedCellText(worksheet, makeCellId(row, column))));
    }
    lines.push(fields.join(","));
  }
  return `${lines.join("\n")}\n`;
}

function safeFilePart(text: string, fallback: string): string {
  const cleaned = String(text ?? "").replace(UNSAFE_FILE_NAME, "_").trim();
  return cleaned === "" ? fallback : cleaned;
}

/** Suggested download file name for the active worksheet, ending in ".csv". */
export function exportFileName(workbookName: string, worksheetName: string): string {
  return `${safeFilePart(workbookName, "workbook")} - ${safeFilePart(worksheetName, "worksheet")}.csv`;
}

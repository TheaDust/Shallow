import { cellName, parseCellName, type Worksheet } from "./workbook";

/** Quotes a field when it contains a comma, a double quote or a line break. */
export function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export interface UsedExtent {
  rows: number;
  cols: number;
}

/**
 * The used rectangle of a worksheet: the persisted used extent (which keeps
 * empty fields and coordinates produced by an import) unioned with the bounding
 * box of the non-empty cells.
 */
export function worksheetUsedExtent(worksheet: Worksheet): UsedExtent {
  let rows = Math.max(0, worksheet.usedRows ?? 0);
  let cols = Math.max(0, worksheet.usedCols ?? 0);
  for (const [name, value] of Object.entries(worksheet.cells ?? {})) {
    if (!value) continue;
    const ref = parseCellName(name);
    if (!ref) continue;
    rows = Math.max(rows, ref.row + 1);
    cols = Math.max(cols, ref.col + 1);
  }
  return { rows, cols };
}

/**
 * Serializes a worksheet as CSV in the grid's row/column order. Cells hold the
 * displayed value, so a formula cell contributes its calculated result. Empty
 * cells inside the used rectangle are written as empty fields.
 */
export function worksheetToCsv(worksheet: Worksheet): string {
  const { rows, cols } = worksheetUsedExtent(worksheet);
  if (rows === 0 || cols === 0) return "";
  const lines: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    const fields: string[] = [];
    for (let col = 0; col < cols; col += 1) {
      fields.push(csvEscape(worksheet.cells[cellName({ row, col })] ?? ""));
    }
    lines.push(fields.join(","));
  }
  return lines.join("\n");
}

/** Suggested download file name for a workbook export; always ends with ".csv". */
export function csvFileName(workbookName: string): string {
  const base = String(workbookName ?? "").replace(/[\\/:*?"<>|]+/g, "-").trim() || "workbook";
  return /\.csv$/i.test(base) ? base : `${base}.csv`;
}

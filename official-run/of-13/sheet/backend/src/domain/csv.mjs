/**
 * CSV helpers for the import workflow. Parsing keeps the original row/column order and
 * every literal character: quoted fields may contain commas, escaped `""` quotes and line
 * breaks, empty fields stay empty, and UTF-8 text is untouched.
 */

import { cellAddress } from "./address.mjs";

export { cellAddress, columnName } from "./address.mjs";

export const INVALID_CSV_MESSAGE = "Invalid CSV file format. Import failed.";

const BOM = "\uFEFF";

/**
 * Parses CSV text into rows of raw field strings.
 * @param {unknown} text
 * @returns {{ ok: true, rows: string[][] } | { ok: false }}
 */
export function parseCsv(text) {
  const source = typeof text === "string" ? (text.startsWith(BOM) ? text.slice(1) : text) : "";
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

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
        continue;
      }
      field += character;
      continue;
    }

    if (character === '"' && field === "") {
      inQuotes = true;
      continue;
    }
    if (character === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (character === "\n" || character === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      continue;
    }
    field += character;
  }

  // A field that opens a quote and never closes it is invalid CSV.
  if (inQuotes) return { ok: false };
  // A trailing line break ends the previous row instead of adding an empty one.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return { ok: true, rows };
}

/** Maps parsed rows onto sparse A1-keyed cells; empty fields stay absent (rendered empty). */
export function cellsFromRows(rows) {
  const cells = {};
  rows.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      if (value !== "") cells[cellAddress(rowIndex, columnIndex)] = value;
    });
  });
  return cells;
}

/** Workbook name for an imported file: the file name without its final `.csv` extension. */
export function workbookNameFromFileName(fileName, fallback) {
  const base = String(fileName ?? "")
    .split(/[\\/]/)
    .pop()
    .replace(/\.csv$/i, "")
    .trim();
  return base || fallback;
}

import { cellName, parseCellName } from "./grid";

/** Exact message required when a CSV payload cannot be parsed. */
export const INVALID_CSV_MESSAGE = "Invalid CSV file format. Import failed.";

export class InvalidCsvError extends Error {
  constructor() {
    super(INVALID_CSV_MESSAGE);
    this.name = "InvalidCsvError";
  }
}

interface CsvShape {
  cells: Record<string, string>;
}

/**
 * Parses RFC 4180-style CSV text into a matrix of raw field text.
 *
 * Preserves row/column order and empty fields, understands fields wrapped in
 * double quotes (including commas, escaped `""` pairs and line breaks inside
 * them) and rejects a field that opens a quote it never closes. Fields are
 * returned verbatim, so UTF-8 text and numeric text stay unchanged.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;
  let index = 0;

  const endField = () => {
    row.push(field);
    field = "";
    started = true;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    started = false;
  };

  while (index < text.length) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
      started = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      endField();
      index += 1;
      continue;
    }
    if (char === "\r") {
      endRow();
      if (text[index + 1] === "\n") index += 1;
      index += 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      index += 1;
      continue;
    }
    field += char;
    started = true;
    index += 1;
  }

  if (quoted) throw new InvalidCsvError();
  if (started) endRow();
  return rows;
}

function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Serializes a worksheet to CSV using its actual row/column order. Every cell
 * inside the used range is emitted, so empty cells become empty fields; text
 * containing commas, quotes or line breaks is quoted and escaped.
 */
export function worksheetToCsv(worksheet: CsvShape): string {
  const keys = Object.keys(worksheet.cells);
  let maxRow = 0;
  let maxColumn = 0;
  for (const key of keys) {
    const position = parseCellName(key);
    if (!position) continue;
    if (position.row > maxRow) maxRow = position.row;
    if (position.column > maxColumn) maxColumn = position.column;
  }
  if (maxRow === 0 || maxColumn === 0) return "";

  const lines: string[] = [];
  for (let row = 1; row <= maxRow; row += 1) {
    const fields: string[] = [];
    for (let column = 1; column <= maxColumn; column += 1) {
      fields.push(escapeCsvField(worksheet.cells[cellName(row, column)] ?? ""));
    }
    lines.push(fields.join(","));
  }
  return lines.join("\n");
}

import { cellName, parseCellName } from "./cells.mjs";

export const INVALID_CSV_MESSAGE = "Invalid CSV file format. Import failed.";

export class CsvError extends Error {
  constructor(message = INVALID_CSV_MESSAGE) {
    super(message);
    this.name = "CsvError";
  }
}

/**
 * Parses CSV text into rows of fields.
 * Keeps the original row/column order, empty fields, quoted commas, escaped
 * `""` pairs and line breaks inside quoted fields. A field that opens with a
 * double quote and never closes it is invalid and raises `CsvError`.
 */
export function parseCsv(input) {
  const text = typeof input === "string" ? input.replace(/^\uFEFF/, "") : "";
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  let index = 0;
  while (index < text.length) {
    const character = text[index];

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += character;
      index += 1;
      continue;
    }

    if (character === '"' && field === "") {
      quoted = true;
      index += 1;
      continue;
    }
    if (character === ",") {
      row.push(field);
      field = "";
      index += 1;
      continue;
    }
    if (character === "\r" || character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += character === "\r" && text[index + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += character;
    index += 1;
  }

  if (quoted) throw new CsvError();

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function asText(value) {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return String(value);
}

/** Quotes a field when it contains a comma, a double quote or a line break. */
export function formatCsvField(value) {
  const text = asText(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function serializeCsv(rows) {
  return rows.map((row) => row.map(formatCsvField).join(",")).join("\n");
}

/** Used range anchored at A1: the largest defined row/column plus one, at least 1x1. */
export function worksheetUsedBounds(worksheet) {
  let rows = 0;
  let columns = 0;
  for (const [name, cell] of Object.entries(worksheet?.cells ?? {})) {
    if (cell === undefined || cell === null) continue;
    const position = parseCellName(name);
    if (!position) continue;
    rows = Math.max(rows, position.row + 1);
    columns = Math.max(columns, position.column + 1);
  }
  return { rows: Math.max(rows, 1), columns: Math.max(columns, 1) };
}

/** Exports a worksheet: displayed (calculated) cell values with empty cells preserved. */
export function worksheetToCsv(worksheet) {
  const bounds = worksheetUsedBounds(worksheet);
  const rows = [];
  for (let row = 0; row < bounds.rows; row += 1) {
    const fields = [];
    for (let column = 0; column < bounds.columns; column += 1) {
      fields.push(asText(worksheet?.cells?.[cellName(row, column)]?.value));
    }
    rows.push(fields);
  }
  return serializeCsv(rows);
}

/** Suggested download name for an exported worksheet; must match the client-side format. */
export function suggestedCsvFilename(workbookName, worksheetName) {
  const safe = (value) => asText(value).replace(/[\\/:*?"<>|]/g, "-").trim();
  return `${safe(workbookName) || "workbook"} - ${safe(worksheetName) || "worksheet"}.csv`;
}

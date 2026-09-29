export class CsvError extends Error {
  constructor(message) {
    super(message);
    this.name = "CsvError";
  }
}

const INVALID_CSV_MESSAGE = "Invalid CSV file format. Import failed.";

/**
 * Parses CSV text into rows of string fields, preserving empty fields and
 * supporting quoted fields with commas, escaped double quotes and line breaks.
 * A field that begins with a double quote but has no closing double quote
 * makes the whole input invalid.
 */
export function parseCsv(text) {
  if (text === "") return [];
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let index = 0;
  const length = text.length;

  while (index < length) {
    const ch = text[index];
    if (inQuotes) {
      if (ch === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += ch;
      index += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      index += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += 1;
      continue;
    }
    if (ch === "\r") {
      if (text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += 1;
      continue;
    }
    field += ch;
    index += 1;
  }

  if (inQuotes) throw new CsvError(INVALID_CSV_MESSAGE);
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function escapeField(value) {
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Serializes rows of string fields to CSV text (CRLF line endings). */
export function serializeCsv(rows) {
  if (rows.length === 0) return "";
  return `${rows.map((row) => row.map(escapeField).join(",")).join("\r\n")}\r\n`;
}

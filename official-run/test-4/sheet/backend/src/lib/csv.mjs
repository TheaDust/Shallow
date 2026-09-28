export class CsvError extends Error {
  constructor(message) {
    super(message);
    this.name = "CsvError";
  }
}

/**
 * Parse CSV text following RFC 4180 conventions:
 * - fields separated by commas, rows separated by LF or CRLF
 * - quoted fields may contain commas, escaped pairs of double quotes, and line breaks
 * - a field that begins with a double quote but has no closing double quote is invalid
 * - empty fields are preserved
 */
export function parseCsv(text) {
  if (typeof text !== "string") {
    throw new CsvError("Invalid CSV file format. Import failed.");
  }
  if (text.trim() === "") return [];

  const rows = [];
  let row = [];
  let field = "";
  let atFieldStart = true;
  let inQuotes = false;
  let endedWithNewline = false;

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
      continue;
    }
    if (atFieldStart && ch === '"') {
      inQuotes = true;
      atFieldStart = false;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      atFieldStart = true;
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      atFieldStart = true;
      endedWithNewline = true;
      i += 1;
      continue;
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      atFieldStart = true;
      endedWithNewline = true;
      i += 1;
      continue;
    }
    field += ch;
    atFieldStart = false;
    i += 1;
  }

  if (inQuotes) {
    throw new CsvError("Invalid CSV file format. Import failed.");
  }
  if (!endedWithNewline) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const NEEDS_QUOTING = /[",\r\n]/;

/**
 * Serialize rows of fields to CSV text (RFC 4180 style):
 * - fields are joined with commas, rows with CRLF, and the text ends with CRLF
 * - fields containing commas, double quotes, or line breaks are quoted
 *   with double quotes escaped as pairs ("")
 * - empty fields are preserved as empty strings between separators
 */
export function serializeCsv(rows) {
  if (!Array.isArray(rows)) {
    throw new CsvError("Invalid CSV rows");
  }
  const lines = rows.map((row) =>
    row
      .map((field) => {
        const value = String(field ?? "");
        if (NEEDS_QUOTING.test(value)) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      })
      .join(","),
  );
  return `${lines.join("\r\n")}\r\n`;
}

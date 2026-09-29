/**
 * Minimal RFC 4180 style CSV reader.
 *
 * Supported: original row/column order, empty fields, quoted fields containing
 * commas, escaped double quotes (""), CRLF / LF / CR record separators and
 * line breaks inside quoted fields. A field that opens with a double quote but
 * never closes it is invalid and raises CsvParseError.
 */

const BOM = "\ufeff";

export class CsvParseError extends Error {
  constructor(message = "Unterminated quoted field") {
    super(message);
    this.name = "CsvParseError";
  }
}

function isRecordBreak(character) {
  return character === "\n" || character === "\r";
}

export function parseCsv(input) {
  const text = typeof input === "string" ? input : String(input ?? "");
  const source = text.charCodeAt(0) === BOM.charCodeAt(0) ? text.slice(1) : text;

  const rows = [];
  let row = [];
  let field = "";
  let index = 0;
  let inQuotes = false;
  let fieldHasContent = false;

  while (index < source.length) {
    const character = source[index];

    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += character;
      index += 1;
      continue;
    }

    if (character === '"' && field === "") {
      inQuotes = true;
      fieldHasContent = true;
      index += 1;
      continue;
    }

    if (character === ",") {
      row.push(field);
      field = "";
      fieldHasContent = false;
      index += 1;
      continue;
    }

    if (isRecordBreak(character)) {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      fieldHasContent = false;
      index += character === "\r" && source[index + 1] === "\n" ? 2 : 1;
      continue;
    }

    field += character;
    fieldHasContent = true;
    index += 1;
  }

  if (inQuotes) throw new CsvParseError("Unterminated quoted field");
  if (fieldHasContent || field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const OUTPUT_LINE_BREAK = "\n";
const NEEDS_QUOTING = /[",\r\n]/;

/** Quotes one field when it contains a comma, a double quote or a line break. */
export function formatCsvField(value) {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (!NEEDS_QUOTING.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Serializes a rectangular list of rows. Fields are joined with commas and
 * rows with LF, so empty fields inside the range stay visible as empty fields.
 */
export function toCsv(rows) {
  return rows.map((row) => row.map(formatCsvField).join(",")).join(OUTPUT_LINE_BREAK);
}

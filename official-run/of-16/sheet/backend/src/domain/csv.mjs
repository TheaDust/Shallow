export const INVALID_CSV_MESSAGE = "Invalid CSV file format. Import failed.";

/** Raised when a CSV document cannot be parsed; the service maps it to a 400 DomainError. */
export class CsvFormatError extends Error {
  constructor() {
    super(INVALID_CSV_MESSAGE);
    this.name = "CsvFormatError";
  }
}

/**
 * Parses RFC 4180 style CSV text into a grid of raw field strings.
 * Row and column order is preserved; empty fields, commas inside double quotes,
 * escaped double quote pairs and line breaks inside quoted fields are kept
 * verbatim. A field that opens with a double quote and never closes is invalid.
 */
export function parseCsv(text) {
  if (typeof text !== "string") throw new CsvFormatError();
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const end = text.length;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (index < end) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
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
      index += 1;
      continue;
    }
    if (character === ",") {
      endField();
      index += 1;
      continue;
    }
    if (character === "\r") {
      if (text[index + 1] === "\n") index += 1;
      endRow();
      index += 1;
      continue;
    }
    if (character === "\n") {
      endRow();
      index += 1;
      continue;
    }
    field += character;
    index += 1;
  }

  if (inQuotes) throw new CsvFormatError();
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** Derives the imported workbook name from the uploaded file name (final .csv removed). */
export function workbookNameFromFileName(fileName) {
  const base = String(fileName ?? "").split(/[\\/]/).pop() ?? "";
  return base.replace(/\.csv$/i, "").trim();
}

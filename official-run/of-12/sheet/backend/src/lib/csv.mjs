import { DomainError } from "./workbooks.mjs";

export const INVALID_CSV_MESSAGE = "Invalid CSV file format. Import failed.";

function stripByteOrderMark(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parses CSV text into rows of raw field strings, keeping the original row and column order.
 *
 * Supported: UTF-8 text, empty fields, commas inside double quoted fields, doubled double quotes
 * inside quoted fields (`""` -> `"`), and CRLF/CR/LF line breaks inside quoted fields (normalized
 * to `\n`). A field that starts with `"` but never closes is invalid CSV.
 */
export function parseCsv(text) {
  if (typeof text !== "string") throw new DomainError(INVALID_CSV_MESSAGE);
  const input = stripByteOrderMark(text);
  const rows = [];
  let row = [];
  let field = "";
  let fieldStarted = false;
  let inQuotes = false;
  let closedQuote = false;
  let index = 0;

  const endField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
    closedQuote = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (index < input.length) {
    const char = input[index];

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        closedQuote = true;
        index += 1;
        continue;
      }
      if (char === "\r") {
        field += "\n";
        index += input[index + 1] === "\n" ? 2 : 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (closedQuote) {
      if (char === ",") {
        endField();
        index += 1;
        continue;
      }
      if (char === "\n") {
        endRow();
        index += 1;
        continue;
      }
      if (char === "\r") {
        endRow();
        index += input[index + 1] === "\n" ? 2 : 1;
        continue;
      }
      throw new DomainError(INVALID_CSV_MESSAGE);
    }

    if (char === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      endField();
      index += 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      index += 1;
      continue;
    }
    if (char === "\r") {
      endRow();
      index += input[index + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += char;
    fieldStarted = true;
    index += 1;
  }

  if (inQuotes) throw new DomainError(INVALID_CSV_MESSAGE);
  if (fieldStarted || row.length > 0) endRow();
  return rows;
}

/**
 * Workbook name derived from the imported file name: the final `.csv` extension (any case) is
 * removed after discarding any directory part.
 */
export function workbookNameFromFileName(fileName) {
  const base = typeof fileName === "string" ? fileName.trim() : "";
  const lastSegment = base.split(/[\\/]/).pop() ?? "";
  const withoutExtension = lastSegment.replace(/\.csv$/i, "").trim();
  return withoutExtension || "Imported workbook";
}

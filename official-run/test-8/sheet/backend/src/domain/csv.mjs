/**
 * RFC 4180-style CSV parsing shared by the import API.
 *
 * Rules implemented for REQ-1-3-1: original row/column order, empty fields
 * preserved, UTF-8 text passed through unchanged, commas inside double quotes,
 * escaped quote pairs ("") and line breaks inside fields. A field whose first
 * character is a double quote without a closing double quote is invalid.
 */

/** Message returned to the client when the uploaded file is not valid CSV. */
export const INVALID_CSV_MESSAGE = "Invalid CSV file format. Import failed.";

/**
 * Parses CSV text into an array of rows (each row an array of raw field text).
 * Returns `{ ok: true, rows }` or `{ ok: false }`; callers turn the failure
 * into the user-facing message above.
 */
export function parseCsv(text) {
  if (typeof text !== "string") return { ok: false };
  // Files exported by spreadsheet tools often start with a UTF-8 BOM.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows = [];
  let record = [];
  let field = "";
  let inQuotes = false;
  /** True once the current record holds anything worth emitting. */
  let recordStarted = false;
  /** True when the current field has been opened explicitly (quote) or written. */
  let fieldStarted = false;

  const endField = () => {
    record.push(field);
    field = "";
    fieldStarted = false;
  };

  const endRecord = () => {
    endField();
    rows.push(record);
    record = [];
    recordStarted = false;
  };

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
      } else if (character === "\r") {
        if (source[index + 1] === "\n") index += 1;
        field += "\n";
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && !fieldStarted && field.length === 0) {
      inQuotes = true;
      fieldStarted = true;
      recordStarted = true;
      continue;
    }

    if (character === ",") {
      endField();
      recordStarted = true;
      continue;
    }

    if (character === "\r" || character === "\n") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      // A trailing line break only terminates the record; it never adds an
      // extra empty row.
      if (recordStarted || fieldStarted || field.length > 0) endRecord();
      continue;
    }

    field += character;
    fieldStarted = true;
    recordStarted = true;
  }

  if (inQuotes) return { ok: false };
  if (recordStarted || fieldStarted || field.length > 0) endRecord();
  return { ok: true, rows };
}

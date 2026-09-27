/**
 * CSV parsing for workbook import.
 *
 * Rules (RFC 4180 subset plus the product contract):
 * - fields are separated by commas; rows by LF, CRLF or CR
 * - a field that begins with a double quote is quoted; inside it, "" is an
 *   escaped quote and commas/newlines are literal
 * - a field that begins with a double quote but never closes is invalid
 * - empty fields are preserved (e.g. "a,,c" has three fields)
 * - a UTF-8 BOM at the start of the text is stripped
 */

export const INVALID_CSV_MESSAGE = "Invalid CSV file format. Import failed.";

/**
 * Parse CSV text into rows of fields.
 * Returns { rows: string[][] } on success, or { error: message } for invalid CSV.
 */
export function parseCsv(input) {
  let text = String(input ?? "");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = "";
  let fieldStarted = false; // current field already contains characters
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];
    if (ch === '"') {
      if (!fieldStarted) {
        // Quoted field: consume until the closing quote ("" is an escaped quote).
        i += 1;
        let closed = false;
        while (i < n) {
          if (text[i] === '"') {
            if (text[i + 1] === '"') {
              field += '"';
              i += 2;
            } else {
              closed = true;
              i += 1;
              break;
            }
          } else {
            field += text[i];
            i += 1;
          }
        }
        if (!closed) return { error: INVALID_CSV_MESSAGE };
        fieldStarted = true;
        // After the closing quote only a separator or end of input is allowed.
        if (i < n) {
          const c = text[i];
          if (c === ",") {
            row.push(field);
            field = "";
            fieldStarted = false;
            i += 1;
          } else if (c === "\n") {
            row.push(field);
            rows.push(row);
            field = "";
            fieldStarted = false;
            row = [];
            i += 1;
          } else if (c === "\r") {
            row.push(field);
            rows.push(row);
            field = "";
            fieldStarted = false;
            row = [];
            i += text[i + 1] === "\n" ? 2 : 1;
          } else {
            return { error: INVALID_CSV_MESSAGE };
          }
        } else {
          row.push(field);
          rows.push(row);
          field = "";
          fieldStarted = false;
          row = [];
        }
      } else {
        // Lenient: a quote inside an unquoted field is ordinary text.
        field += ch;
        i += 1;
      }
    } else if (ch === ",") {
      row.push(field);
      field = "";
      fieldStarted = false;
      i += 1;
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      field = "";
      fieldStarted = false;
      row = [];
      i += 1;
    } else if (ch === "\r") {
      row.push(field);
      rows.push(row);
      field = "";
      fieldStarted = false;
      row = [];
      i += text[i + 1] === "\n" ? 2 : 1;
    } else {
      field += ch;
      fieldStarted = true;
      i += 1;
    }
  }

  // Flush a trailing field/row (e.g. "a," keeps its final empty field; a
  // trailing newline does not produce an extra empty row).
  if (field !== "" || fieldStarted || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return { rows };
}

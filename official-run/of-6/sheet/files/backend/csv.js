'use strict';

const INVALID_CSV_MESSAGE = 'Invalid CSV file format. Import failed.';

// Parses CSV text into an array of rows; each row is an array of string fields.
// - Fields are separated by commas; empty fields (leading, middle, trailing) are
//   preserved as ''.
// - A field that begins with a double quote is quoted: commas and line breaks
//   inside the quotes are literal, and "" is an escaped double quote.
// - A quoted field that is never closed is invalid and throws INVALID_CSV_MESSAGE.
// - \n, \r and \r\n terminate records outside quotes; line breaks inside quotes
//   are kept verbatim.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
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
    } else if (ch === '"' && field === '') {
      inQuotes = true;
      i += 1;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') {
        i += 1;
      }
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }

  if (inQuotes) {
    throw new Error(INVALID_CSV_MESSAGE);
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function columnLetter(index) {
  let n = index;
  let out = '';
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

function cellCoordinate(row, column) {
  return columnLetter(column) + (row + 1);
}

module.exports = { parseCsv, cellCoordinate, INVALID_CSV_MESSAGE };

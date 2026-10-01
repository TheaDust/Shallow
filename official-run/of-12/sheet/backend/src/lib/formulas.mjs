import { columnIndex, columnLabel } from "./spreadsheet.mjs";

/**
 * Rewriting of A1-style references inside formula text, shared by the row/column structure
 * operations. A shift descriptor describes one insert/delete on one axis:
 *
 *   { axis: "row" | "column", kind: "insert" | "delete", index: <0-based>, count: <n> }
 *
 * References to another worksheet (`Other!A1`) are never rewritten; a reference without a prefix
 * or with the current worksheet name is rewritten. A reference whose target no longer exists turns
 * into `#REF!` so the grid displays an explicit error.
 */

export function rowInsertShift(index, count = 1) {
  return { axis: "row", kind: "insert", index, count };
}

export function rowDeleteShift(index, count = 1) {
  return { axis: "row", kind: "delete", index, count };
}

export function columnInsertShift(index, count = 1) {
  return { axis: "column", kind: "insert", index, count };
}

export function columnDeleteShift(index, count = 1) {
  return { axis: "column", kind: "delete", index, count };
}

/** Moves one 0-based coordinate; returns `null` when the row/column itself was deleted. */
export function shiftIndex(value, shift) {
  if (!shift) return value;
  if (shift.kind === "insert") return value >= shift.index ? value + shift.count : value;
  const lastRemoved = shift.index + shift.count - 1;
  if (value >= shift.index && value <= lastRemoved) return null;
  return value > lastRemoved ? value - shift.count : value;
}

/** One endpoint of a reference; `null` means the endpoint was removed by a delete. */
function shiftPosition(position, shifts) {
  var row = position.row;
  var column = position.column;
  for (const shift of shifts) {
    const moved = shift.axis === "row" ? shiftIndex(row, shift) : shiftIndex(column, shift);
    if (moved === null) return null;
    if (shift.axis === "row") row = moved;
    else column = moved;
  }
  return { row, column };
}

function referenceText(dollarColumn, column, dollarRow, row) {
  return `${dollarColumn}${columnLabel(column)}${dollarRow}${row + 1}`;
}

const REFERENCE = new RegExp(
  [
    "(?:('[^']*'|[A-Za-z_][A-Za-z0-9_.]*)!)?", // 1 sheet name (prefix without `!`)
    "(\\$?)([A-Za-z]{1,3})(\\$?)([1-9][0-9]*)", // 2-5 first endpoint
    "(?::(\\$?)([A-Za-z]{1,3})(\\$?)([1-9][0-9]*))?", // 6-9 optional second endpoint
  ].join(""),
  "g",
);

function shiftReferenceEndpoint(shifts, dollarColumn, letters, dollarRow, digits) {
  const column = columnIndex(letters.toUpperCase());
  if (column < 0) return null;
  const moved = shiftPosition({ row: Number(digits) - 1, column }, shifts);
  if (!moved) return null;
  return referenceText(dollarColumn, moved.column, dollarRow, moved.row);
}

function rewriteChunk(chunk, shifts, sheetName) {
  return chunk.replace(REFERENCE, (...groups) => {
    const [match, prefix, dollarColumn, letters, dollarRow, digits, endDollarColumn, endLetters, endDollarRow, endDigits] = groups;
    if (prefix) {
      const name = prefix.replace(/^'(.*)'$/s, "$1").replace(/''/g, "'");
      if (sheetName === null || name.toLowerCase() !== String(sheetName).toLowerCase()) return match;
    }
    const target = prefix ? `${prefix}!` : "";
    const start = shiftReferenceEndpoint(shifts, dollarColumn, letters, dollarRow, digits);
    if (!start) return `${target}#REF!`;
    if (endDigits === undefined) return `${target}${start}`;
    const end = shiftReferenceEndpoint(shifts, endDollarColumn, endLetters, endDollarRow, endDigits);
    if (!end) return `${target}#REF!`;
    return `${target}${start}:${end}`;
  });
}

/** Applies `transform` to every part of `text` that lies outside double-quoted string literals. */
export function outsideStringLiterals(text, transform) {
  let result = "";
  let index = 0;
  while (index < text.length) {
    const quote = text.indexOf('"', index);
    if (quote === -1) {
      result += transform(text.slice(index));
      break;
    }
    result += transform(text.slice(index, quote));
    let end = quote + 1;
    while (end < text.length) {
      if (text[end] === '"') {
        if (text[end + 1] === '"') {
          end += 2;
          continue;
        }
        end += 1;
        break;
      }
      end += 1;
    }
    result += text.slice(quote, end);
    index = end;
  }
  return result;
}

/**
 * Copy semantics: one endpoint of a reference moved by the target offset. A `$`-pinned part keeps
 * its row/column, an unpinned one follows the offset; a reference that would leave the grid has no
 * endpoint (`null`), which the caller turns into `#REF!`.
 */
function offsetReferenceEndpoint(dollarColumn, letters, dollarRow, digits, rowDelta, columnDelta) {
  const column = columnIndex(letters.toUpperCase());
  if (column < 0) return null;
  const movedColumn = dollarColumn ? column : column + columnDelta;
  const movedRow = dollarRow ? Number(digits) - 1 : Number(digits) - 1 + rowDelta;
  if (movedColumn < 0 || movedRow < 0) return null;
  return referenceText(dollarColumn, movedColumn, dollarRow, movedRow);
}

/**
 * Rewrites the references of a formula for a copy/paste offset: relative references follow the
 * target, absolute (`$`) parts stay put, and a reference pushed outside the grid becomes `#REF!`.
 * Non-formula values are returned untouched.
 */
export function adjustFormulaOffset(value, { rowDelta = 0, columnDelta = 0 } = {}) {
  if (typeof value !== "string" || value[0] !== "=") return value;
  if (!rowDelta && !columnDelta) return value;
  return outsideStringLiterals(value, (chunk) => chunk.replace(REFERENCE, (...groups) => {
    const [match, prefix, dollarColumn, letters, dollarRow, digits, endDollarColumn, endLetters, endDollarRow, endDigits] = groups;
    const target = prefix ? `${prefix}!` : "";
    const start = offsetReferenceEndpoint(dollarColumn, letters, dollarRow, digits, rowDelta, columnDelta);
    if (!start) return `${target}#REF!`;
    if (endDigits === undefined) return `${target}${start}`;
    const end = offsetReferenceEndpoint(endDollarColumn, endLetters, endDollarRow, endDigits, rowDelta, columnDelta);
    if (!end) return `${target}#REF!`;
    return `${target}${start}:${end}`;
  }));
}

/**
 * Rewrites the references of one cell value. Non-formula values (and values without a leading `=`)
 * are returned untouched; `sheetName` is the worksheet the formula lives in.
 */
export function adjustFormulaText(value, shifts, { sheetName = null } = {}) {
  if (typeof value !== "string" || value[0] !== "=") return value;
  const active = shifts.filter(Boolean);
  if (!active.length) return value;
  return outsideStringLiterals(value, (chunk) => rewriteChunk(chunk, active, sheetName));
}

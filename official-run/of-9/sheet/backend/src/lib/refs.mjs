/**
 * Spreadsheet coordinate and reference helpers shared by the workbook service.
 * Pure functions; no I/O.
 */

/** 0-based column index -> spreadsheet column label (A, B, ..., Z, AA, ...). */
export function columnLabel(index) {
  let label = "";
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

/** Column label -> 1-based column index (A -> 1). Returns 0 for invalid labels. */
export function columnIndex(label) {
  let index = 0;
  for (const ch of String(label).toUpperCase()) {
    if (ch < "A" || ch > "Z") return 0;
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index;
}

/** 1-based row/column -> cell coordinate such as A1. */
export function cellCoordinate(row, column) {
  return `${columnLabel(column - 1)}${row}`;
}

/** Parses a cell coordinate such as "A1" into 1-based row/column. */
export function parseCoordinate(coordinate) {
  const match = /^([A-Z]+)(\d+)$/.exec(String(coordinate));
  if (!match) return null;
  const column = columnIndex(match[1]);
  if (column === 0) return null;
  return { row: Number(match[2]), column };
}

/**
 * Structure operations applied to a worksheet.
 * - insert-row-above / insert-row-below / delete-row with 1-based `at`
 * - insert-column-left / insert-column-right / delete-column with 1-based `at`
 */
export const STRUCTURE_OPS = new Set([
  "insert-row-above",
  "insert-row-below",
  "delete-row",
  "insert-column-left",
  "insert-column-right",
  "delete-column",
]);

function isRowOp(op) {
  return op.type === "insert-row-above" || op.type === "insert-row-below" || op.type === "delete-row";
}

/** Row transform for a single (non-range) reference. Returns null when broken (#REF!). */
function transformSingleRow(row, op) {
  if (op.type === "insert-row-above") return row >= op.at ? row + 1 : row;
  if (op.type === "insert-row-below") return row > op.at ? row + 1 : row;
  if (op.type === "delete-row") {
    if (row === op.at) return null;
    return row > op.at ? row - 1 : row;
  }
  return row;
}

/** Row transform for a range's start/end pair. Returns null when the range collapses. */
function transformRangeRows(startRow, endRow, op) {
  if (op.type === "insert-row-above") {
    return [startRow >= op.at ? startRow + 1 : startRow, endRow >= op.at ? endRow + 1 : endRow];
  }
  if (op.type === "insert-row-below") {
    return [startRow > op.at ? startRow + 1 : startRow, endRow > op.at ? endRow + 1 : endRow];
  }
  if (op.type === "delete-row") {
    const start = startRow > op.at ? startRow - 1 : startRow;
    const end = endRow >= op.at ? endRow - 1 : endRow;
    return end < start ? null : [start, end];
  }
  return [startRow, endRow];
}

/** Column transform for a single (non-range) reference. Returns null when broken (#REF!). */
function transformSingleColumn(column, op) {
  if (op.type === "insert-column-left") return column >= op.at ? column + 1 : column;
  if (op.type === "insert-column-right") return column > op.at ? column + 1 : column;
  if (op.type === "delete-column") {
    if (column === op.at) return null;
    return column > op.at ? column - 1 : column;
  }
  return column;
}

/** Column transform for a range's start/end pair. Returns null when the range collapses. */
function transformRangeColumns(startColumn, endColumn, op) {
  if (op.type === "insert-column-left") {
    return [
      startColumn >= op.at ? startColumn + 1 : startColumn,
      endColumn >= op.at ? endColumn + 1 : endColumn,
    ];
  }
  if (op.type === "insert-column-right") {
    return [startColumn > op.at ? startColumn + 1 : startColumn, endColumn > op.at ? endColumn + 1 : endColumn];
  }
  if (op.type === "delete-column") {
    const start = startColumn > op.at ? startColumn - 1 : startColumn;
    const end = endColumn >= op.at ? endColumn - 1 : endColumn;
    return end < start ? null : [start, end];
  }
  return [startColumn, endColumn];
}

const REF_TOKEN_RE = /([A-Za-z_][A-Za-z0-9_]*!)?(\$?)([A-Z]+)(\$?)(\d+)/g;

/**
 * Rewrites cell references inside a formula after a row/column structure change.
 * References to the current sheet are adjusted; references with an explicit sheet
 * prefix (e.g. `Sheet2!A1`) belong to another grid and are left untouched.
 * Unpreservable references become `#REF!`.
 */
export function rewriteFormulaReferences(formula, op) {
  if (typeof formula !== "string" || formula === "") return formula;
  const tokens = [];
  let match;
  REF_TOKEN_RE.lastIndex = 0;
  while ((match = REF_TOKEN_RE.exec(formula))) {
    tokens.push({
      start: match.index,
      end: match.index + match[0].length,
      sheet: match[1] ?? "",
      absCol: match[2],
      colText: match[3],
      absRow: match[4],
      row: Number(match[5]),
    });
  }
  if (tokens.length === 0) return formula;
  for (let i = 1; i < tokens.length; i += 1) {
    if (formula.slice(tokens[i - 1].end, tokens[i].start).trim() === ":") {
      tokens[i - 1].rangeEnd = tokens[i];
      tokens[i].rangeStart = tokens[i - 1];
    }
  }

  const renderCellRef = (token, row, column) =>
    `${token.sheet}${token.absCol}${columnLabel(column - 1)}${token.absRow}${row}`;

  let out = "";
  let cursor = 0;
  for (const token of tokens) {
    if (token.rangeStart) {
      // Range end token: the start token already rendered the whole pair.
      cursor = token.end;
      continue;
    }
    out += formula.slice(cursor, token.start);
    cursor = token.end;
    if (token.sheet !== "") {
      out += formula.slice(token.start, token.end);
      continue;
    }
    if (token.rangeEnd) {
      const endToken = token.rangeEnd;
      if (isRowOp(op)) {
        const pair = transformRangeRows(token.row, endToken.row, op);
        if (pair === null) {
          out += "#REF!";
        } else {
          out += `${renderCellRef(token, pair[0], columnIndex(token.colText))}:${renderCellRef(endToken, pair[1], columnIndex(endToken.colText))}`;
        }
      } else {
        const pair = transformRangeColumns(columnIndex(token.colText), columnIndex(endToken.colText), op);
        if (pair === null) {
          out += "#REF!";
        } else {
          out += `${renderCellRef(token, token.row, pair[0])}:${renderCellRef(endToken, endToken.row, pair[1])}`;
        }
      }
      continue;
    }
    if (isRowOp(op)) {
      const row = transformSingleRow(token.row, op);
      out += row === null ? "#REF!" : renderCellRef(token, row, columnIndex(token.colText));
    } else {
      const column = transformSingleColumn(columnIndex(token.colText), op);
      out += column === null ? "#REF!" : renderCellRef(token, token.row, column);
    }
  }
  out += formula.slice(cursor);
  return out;
}

/** Shifts the cells of a worksheet for a structure change, dropping deleted cells. */
export function shiftCells(cells, op) {
  const next = {};
  for (const [coordinate, cell] of Object.entries(cells)) {
    const parsed = parseCoordinate(coordinate);
    if (!parsed) continue;
    if (op.type === "delete-row" && parsed.row === op.at) continue;
    if (op.type === "delete-column" && parsed.column === op.at) continue;
    let row = parsed.row;
    let column = parsed.column;
    if (op.type === "insert-row-above" && row >= op.at) row += 1;
    else if (op.type === "insert-row-below" && row > op.at) row += 1;
    else if (op.type === "delete-row" && row > op.at) row -= 1;
    else if (op.type === "insert-column-left" && column >= op.at) column += 1;
    else if (op.type === "insert-column-right" && column > op.at) column += 1;
    else if (op.type === "delete-column" && column > op.at) column -= 1;
    next[cellCoordinate(row, column)] = cell;
  }
  return next;
}

/** Shifts a rectangular range `{ start: {row, column}, end: {row, column} }`; null when it collapses. */
export function shiftRange(range, op) {
  if (!range || !range.start || !range.end) return range;
  if (isRowOp(op)) {
    const pair = transformRangeRows(range.start.row, range.end.row, op);
    if (pair === null) return null;
    return {
      start: { ...range.start, row: pair[0] },
      end: { ...range.end, row: pair[1] },
    };
  }
  const pair = transformRangeColumns(range.start.column, range.end.column, op);
  if (pair === null) return null;
  return {
    start: { ...range.start, column: pair[0] },
    end: { ...range.end, column: pair[1] },
  };
}

/** Normalizes a range so start is the top-left corner. Returns null when invalid. */
export function normalizeRange(range) {
  if (!range || !range.start || !range.end) return null;
  const startRow = Number(range.start.row);
  const startColumn = Number(range.start.column);
  const endRow = Number(range.end.row);
  const endColumn = Number(range.end.column);
  if (
    !Number.isInteger(startRow) || !Number.isInteger(startColumn) ||
    !Number.isInteger(endRow) || !Number.isInteger(endColumn) ||
    startRow < 1 || startColumn < 1 || endRow < 1 || endColumn < 1
  ) {
    return null;
  }
  return {
    start: {
      row: Math.min(startRow, endRow),
      column: Math.min(startColumn, endColumn),
    },
    end: {
      row: Math.max(startRow, endRow),
      column: Math.max(startColumn, endColumn),
    },
  };
}

/** True when the 1-based row/column lies inside the (normalizable) range. */
export function rangeContains(range, row, column) {
  if (!range || !range.start || !range.end) return false;
  return (
    row >= Math.min(range.start.row, range.end.row) &&
    row <= Math.max(range.start.row, range.end.row) &&
    column >= Math.min(range.start.column, range.end.column) &&
    column <= Math.max(range.start.column, range.end.column)
  );
}

/** Lists every coordinate string inside a range (top-left to bottom-right). */
export function rangeCoordinates(range) {
  const normalized = normalizeRange(range);
  if (!normalized) return [];
  const coordinates = [];
  for (let row = normalized.start.row; row <= normalized.end.row; row += 1) {
    for (let column = normalized.start.column; column <= normalized.end.column; column += 1) {
      coordinates.push(cellCoordinate(row, column));
    }
  }
  return coordinates;
}

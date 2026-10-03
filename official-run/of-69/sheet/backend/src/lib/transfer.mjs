import { cellName, columnLabel, parseCellName } from "./cells.mjs";
import { INVALID_REFERENCE_ERROR } from "./formula.mjs";

/** Supported range transfer modes: a copy leaves the source, a cut moves and clears it. */
export const TRANSFER_MODES = Object.freeze(["copy", "cut"]);

const REFERENCE_PATTERN = /(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]*)/y;
const PREVIOUS_IDENTIFIER = /[A-Za-z0-9_$.]/;
const NEXT_IDENTIFIER = /[A-Za-z0-9_]/;

function columnIndex(letters) {
  let index = 0;
  for (const character of letters.toUpperCase()) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  }
  return index - 1;
}

function isReferenceBoundary(segment, start, end) {
  const previous = start > 0 ? segment[start - 1] : "";
  const next = end < segment.length ? segment[end] : "";
  if (previous && PREVIOUS_IDENTIFIER.test(previous)) return false;
  if (next && NEXT_IDENTIFIER.test(next)) return false;
  // `LOG10(...)` is a function call, not the cell `LOG10`.
  if (next === "(") return false;
  return true;
}

/** One A1 reference shifted by the paste offset; `null` when it leaves the sheet. */
function offsetReference(match, rowOffset, columnOffset) {
  const columnAbsolute = match[1] === "$";
  const rowAbsolute = match[3] === "$";
  const row = Number(match[4]) - 1 + (rowAbsolute ? 0 : rowOffset);
  const column = columnIndex(match[2]) + (columnAbsolute ? 0 : columnOffset);
  if (row < 0 || column < 0) return null;
  return `${match[1]}${columnLabel(column)}${match[3]}${row + 1}`;
}

function offsetSegment(segment, rowOffset, columnOffset) {
  let result = "";
  let invalid = false;
  let index = 0;
  while (index < segment.length) {
    REFERENCE_PATTERN.lastIndex = index;
    const match = REFERENCE_PATTERN.exec(segment);
    if (!match || !isReferenceBoundary(segment, index, index + match[0].length)) {
      result += segment[index];
      index += 1;
      continue;
    }
    let end = index + match[0].length;
    let rangeEnd = null;
    if (segment[end] === ":") {
      REFERENCE_PATTERN.lastIndex = end + 1;
      const candidate = REFERENCE_PATTERN.exec(segment);
      if (candidate && isReferenceBoundary(segment, end + 1, end + 1 + candidate[0].length)) {
        rangeEnd = { match: candidate, end: end + 1 + candidate[0].length };
      }
    }
    if (rangeEnd) {
      const start = offsetReference(match, rowOffset, columnOffset);
      const stop = offsetReference(rangeEnd.match, rowOffset, columnOffset);
      if (start && stop) {
        result += `${start}:${stop}`;
      } else {
        result += "#REF!";
        invalid = true;
      }
      index = rangeEnd.end;
      continue;
    }
    const shifted = offsetReference(match, rowOffset, columnOffset);
    if (shifted === null) {
      result += "#REF!";
      invalid = true;
    } else {
      result += shifted;
    }
    index = end;
  }
  return { text: result, invalid };
}

/**
 * Rewrites the A1 references of a copied formula by the paste offset: relative parts
 * move with the target, `$`-absolute parts stay put. When the offset drives any
 * relative reference off the sheet the whole formula becomes `=#REF!`, so the target
 * formula bar and grid agree on the invalid result. References inside quoted string
 * literals are data, not coordinates.
 */
export function translateFormula(formula, rowOffset, columnOffset) {
  const text = String(formula ?? "");
  if (!text) return text;
  let invalid = false;
  const translated = text
    .split('"')
    .map((segment, position) => {
      if (position % 2 !== 0) return segment;
      const shifted = offsetSegment(segment, rowOffset, columnOffset);
      if (shifted.invalid) invalid = true;
      return shifted.text;
    })
    .join('"');
  if (!invalid) return translated;
  return text.startsWith("=") ? `=${INVALID_REFERENCE_ERROR}` : INVALID_REFERENCE_ERROR;
}

/** Inclusive bounds of a `{anchor, focus}` rectangle, or `null` for malformed coordinates. */
export function selectionBounds(selection) {
  const anchor = parseCellName(selection?.anchor);
  const focus = parseCellName(selection?.focus ?? selection?.anchor);
  if (!anchor || !focus) return null;
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.column, focus.column),
    right: Math.max(anchor.column, focus.column),
  };
}

/** Top-left coordinate of a `{anchor, focus}` rectangle, or `null` when malformed. */
export function selectionTopLeft(selection) {
  const bounds = selectionBounds(selection);
  return bounds ? { row: bounds.top, column: bounds.left } : null;
}

/**
 * Cells of one worksheet after moving `source` onto `target` (top-left aligned).
 * `copy` leaves the source, `cut` clears it first, so an overlapping target keeps the
 * moved values. Every position of the rectangle is written, so trailing blanks clear.
 */
export function transferCells(worksheet, { mode, source, target }) {
  const src = selectionBounds(source);
  const targetTopLeft = selectionTopLeft(target);
  if (!src || !targetTopLeft) return null;
  const height = src.bottom - src.top + 1;
  const width = src.right - src.left + 1;
  if (targetTopLeft.row + height > worksheet.rowCount || targetTopLeft.column + width > worksheet.columnCount) {
    return null;
  }
  const rowOffset = targetTopLeft.row - src.top;
  const columnOffset = targetTopLeft.column - src.left;
  const original = worksheet.cells ?? {};
  const cells = structuredClone(original);
  const moves = [];
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      moves.push({
        from: cellName(src.top + row, src.left + column),
        to: cellName(targetTopLeft.row + row, targetTopLeft.column + column),
      });
    }
  }
  if (mode === "cut") {
    for (const move of moves) delete cells[move.from];
  }
  for (const move of moves) {
    const cell = original[move.from];
    if (!cell) {
      delete cells[move.to];
      continue;
    }
    const next = { ...cell };
    if (typeof cell.formula === "string" && cell.formula !== "") {
      next.formula = translateFormula(cell.formula, rowOffset, columnOffset);
    }
    cells[move.to] = next;
  }
  return { cells, targets: moves.map((move) => move.to) };
}

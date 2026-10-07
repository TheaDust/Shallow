/**
 * Sorting a rectangular range of one worksheet by one of its columns.
 *
 * Only the selected rectangle changes: every record (the cells of one row
 * inside the range) moves as a unit, so values outside the range and every
 * other worksheet stay exactly as they were. The first row may be declared a
 * header, in which case it keeps its position and does not participate.
 *
 * Numbers and parseable dates compare by their value, everything else by text;
 * equal keys keep their original relative order (the sort is stable). A formula
 * cell moves with its record and its relative row references follow the move
 * (`$`-anchored rows keep pointing at the same row), so the formula bar and the
 * displayed results stay consistent with the record's new position.
 *
 * The function is pure and returns a new cell map; the store writes it in one
 * atomic update, so a rejected sort never leaves a half-reordered grid behind.
 */

import { cellName, parseArea } from "./grid.mjs";

export const SORT_ORDERS = ["asc", "desc"];

/** Formula cell references inside a body, `$`-anchors included. */
const REFERENCE_PATTERN = /(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]*)/g;

function parseNumber(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function parseDate(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "") return null;
  const value = Date.parse(trimmed);
  return Number.isNaN(value) ? null : value;
}

/**
 * Compares two cell texts: both numbers by value, both parseable dates by
 * timestamp, otherwise as trimmed text. Mixed kinds fall back to text, so the
 * result is always a total order.
 */
export function compareSortValues(left, right) {
  const leftText = String(left ?? "");
  const rightText = String(right ?? "");
  const leftNumber = parseNumber(leftText);
  const rightNumber = parseNumber(rightText);
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  const leftDate = parseDate(leftText);
  const rightDate = parseDate(rightText);
  if (leftDate !== null && rightDate !== null) return leftDate - rightDate;
  return leftText.trim().localeCompare(rightText.trim());
}

/** Rewrites the relative row references of a formula moved by `rowOffset` rows. */
export function shiftFormulaRows(formula, rowOffset) {
  if (rowOffset === 0 || typeof formula !== "string" || !formula.startsWith("=")) return formula;
  return formula.replace(
    REFERENCE_PATTERN,
    (match, columnAbsolute, letters, rowAbsolute, rowDigits, offset, source) => {
      const previous = offset > 0 ? source[offset - 1] : "";
      const following = source[offset + match.length] ?? "";
      // Skip matches glued to a name or another reference part.
      if (/[A-Za-z0-9_$]/.test(previous) || /[A-Za-z0-9_]/.test(following)) return match;
      if (rowAbsolute) return match;
      const row = Number(rowDigits) + rowOffset;
      if (row < 1) return "#REF!";
      return `${columnAbsolute}${letters}${rowAbsolute}${row}`;
    },
  );
}

/**
 * Returns a new cell map with the records of `range` reordered by `column`.
 * `range` is an A1 area, `column` an absolute 1-based column inside it, `order`
 * `"asc"` or `"desc"` and `hasHeaderRow` whether the top row keeps its place.
 * Returns `null` for a malformed range so the caller can report an error.
 */
export function sortRangeCells(cells, { range, column, order, hasHeaderRow } = {}) {
  const bounds = parseArea(range);
  if (!bounds) return null;
  const firstDataRow = hasHeaderRow === true ? bounds.top + 1 : bounds.top;
  if (firstDataRow > bounds.bottom) return { ...cells };

  const dataRows = [];
  for (let row = firstDataRow; row <= bounds.bottom; row += 1) dataRows.push(row);
  const keyOf = (row) => cells[cellName(row, column)];
  const isBlank = (row) => String(keyOf(row) ?? "").trim() === "";

  const decorated = dataRows.map((row, index) => ({ row, index }));
  decorated.sort((a, b) => {
    // Blank sort keys stay at the bottom in both directions.
    const leftBlank = isBlank(a.row);
    const rightBlank = isBlank(b.row);
    if (leftBlank !== rightBlank) return leftBlank ? 1 : -1;
    const primary = compareSortValues(keyOf(a.row), keyOf(b.row));
    if (primary !== 0) return order === "desc" ? -primary : primary;
    return a.index - b.index;
  });

  const next = { ...cells };
  decorated.forEach(({ row: sourceRow }, position) => {
    const targetRow = firstDataRow + position;
    const rowOffset = targetRow - sourceRow;
    for (let cellColumn = bounds.left; cellColumn <= bounds.right; cellColumn += 1) {
      const raw = cells[cellName(sourceRow, cellColumn)];
      const target = cellName(targetRow, cellColumn);
      if (raw === undefined) delete next[target];
      else next[target] = shiftFormulaRows(raw, rowOffset);
    }
  });
  return next;
}

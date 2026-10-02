import { adjustFormulaOffset } from "./formulas.mjs";
import { cellCoordinate, columnIndex, parseCellCoordinate } from "./spreadsheet.mjs";

/**
 * Sorting of one rectangular range of a worksheet (REQ-5-1-1).
 *
 * Sorting rewrites the cells of the selected range only: whole records move together by row, the
 * rows outside the selection keep their coordinate and value, and a formula that moves with its
 * record follows the row offset, so the formula bar and the grid stay consistent with the new
 * positions. The plan is computed from the current cells before anything is written, so a refused
 * request leaves the worksheet in its original order.
 */

export const ASCENDING_ORDER = "ascending";
export const DESCENDING_ORDER = "descending";
export const SORT_ORDERS = [ASCENDING_ORDER, DESCENDING_ORDER];

/** Ranks of the comparable kinds: numbers first, then parseable dates, text and empty cells. */
const NUMBER_RANK = 0;
const DATE_RANK = 1;
const TEXT_RANK = 2;
const EMPTY_RANK = 3;

/** Normalized rectangle of a `{ start, end }` range; the corners may come in any order. */
export function sortRectangle(range) {
  const start = parseCellCoordinate(range?.start);
  const end = parseCellCoordinate(range?.end);
  if (!start || !end) return null;
  return {
    minRow: Math.min(start.row, end.row),
    maxRow: Math.max(start.row, end.row),
    minColumn: Math.min(start.column, end.column),
    maxColumn: Math.max(start.column, end.column),
  };
}

/**
 * Comparable key of one cell text. A number is compared numerically, a parseable date
 * chronologically, anything else as text (case-insensitively), and an empty cell sorts after
 * every other kind when ascending.
 */
export function cellSortKey(text) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed === "") return { rank: EMPTY_RANK };
  const number = Number(trimmed);
  if (Number.isFinite(number)) return { rank: NUMBER_RANK, number };
  const date = Date.parse(trimmed);
  if (Number.isFinite(date)) return { rank: DATE_RANK, date };
  return { rank: TEXT_RANK, text: trimmed.toLowerCase() };
}

function compareNumbers(first, second) {
  if (first === second) return 0;
  return first < second ? -1 : 1;
}

/** Order of two keys of the same kind; keys of different kinds follow their rank. */
export function compareSortKeys(first, second) {
  if (first.rank !== second.rank) return compareNumbers(first.rank, second.rank);
  if (first.rank === NUMBER_RANK) return compareNumbers(first.number, second.number);
  if (first.rank === DATE_RANK) return compareNumbers(first.date, second.date);
  if (first.rank === TEXT_RANK) {
    if (first.text === second.text) return 0;
    return first.text < second.text ? -1 : 1;
  }
  return 0;
}

/** Header text of one column of the range: the value of the range's first row. */
export function sortHeaderText(cells, range, column) {
  const bounds = sortRectangle(range);
  const index = columnIndex(column);
  if (!bounds || index < 0 || index < bounds.minColumn || index > bounds.maxColumn) return "";
  return (cells[cellCoordinate(bounds.minRow, index)] ?? "").trim();
}

/**
 * New cell map of the sorted range, or `null` when the request cannot be sorted (unknown range or
 * a sort column outside it). `hasHeaderRow` keeps the first row of the range out of the sort.
 * Records with equal sort keys keep their original relative order.
 */
export function planRangeSort(cells, { range, column, order, hasHeaderRow = false } = {}) {
  const bounds = sortRectangle(range);
  const index = columnIndex(column);
  if (!bounds || index < 0 || index < bounds.minColumn || index > bounds.maxColumn) return null;

  const firstDataRow = bounds.minRow + (hasHeaderRow ? 1 : 0);
  const records = [];
  for (let row = firstDataRow; row <= bounds.maxRow; row += 1) {
    const values = [];
    for (let position = bounds.minColumn; position <= bounds.maxColumn; position += 1) {
      values.push(cells[cellCoordinate(row, position)] ?? "");
    }
    records.push({ row, values, key: cellSortKey(values[index - bounds.minColumn]) });
  }

  const direction = order === DESCENDING_ORDER ? -1 : 1;
  const ordered = records
    .map((record, position) => ({ record, position }))
    // Equal keys keep their original relative order, in both directions.
    .sort((first, second) => direction * compareSortKeys(first.record.key, second.record.key)
      || first.position - second.position)
    .map((entry) => entry.record);

  const next = { ...cells };
  ordered.forEach((record, offset) => {
    const targetRow = firstDataRow + offset;
    const rowDelta = targetRow - record.row;
    record.values.forEach((value, position) => {
      const coordinate = cellCoordinate(targetRow, bounds.minColumn + position);
      if (value === "") {
        delete next[coordinate];
        return;
      }
      next[coordinate] = value[0] === "=" ? adjustFormulaOffset(value, { rowDelta }) : value;
    });
  });
  return next;
}

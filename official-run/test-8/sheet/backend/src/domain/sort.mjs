import { cellCoordinate } from "./workbook-model.mjs";
import { mapFormulaRows } from "./formula.mjs";

/**
 * Sorting one rectangular range of a worksheet.
 *
 * The command reorders whole records (the rows of the selected rectangle) in
 * place: the header row of the range is skipped when `hasHeaderRow` is set,
 * records move together row by row, the cells outside the rectangle keep their
 * values and their coordinates, and equal sort keys keep their original
 * relative order (the sort is stable). Only `worksheet.cells` changes, so the
 * stored filter, validation rules and selection keep describing the very same
 * rectangle.
 *
 * Sort keys are compared by their type: numbers numerically, dates by their
 * timestamp and text alphabetically, with blanks last when ascending.
 */

export const SORT_ORDERS = ["ascending", "descending"];

/** The order used when a caller does not state one. */
export const DEFAULT_SORT_ORDER = "ascending";

const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Text shapes recognized as dates: ISO, `d/m/y` and `d-Mon-y`. */
const DATE_PATTERNS = [
  /^\d{4}-\d{1,2}-\d{1,2}(?:[T ][0-9:.]+.*)?$/,
  /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
  /^\d{1,2}-[A-Za-z]{3,}-\d{2,4}$/,
];

const KIND_RANK = { number: 0, date: 1, text: 2, blank: 3 };

/** True when the trimmed text is a parseable date (ISO, `d/m/y`, `d-Mon-y`). */
export function isDateText(text) {
  return DATE_PATTERNS.some((pattern) => pattern.test(text)) && Number.isFinite(Date.parse(text));
}

/** Comparison class of one sort key: `number`, `date`, `text` or `blank`. */
export function sortValueKind(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") return "blank";
  if (NUMBER_PATTERN.test(text)) return "number";
  if (isDateText(text)) return "date";
  return "text";
}

/**
 * Compares two sort keys by their respective types: numbers numerically, dates
 * chronologically, text alphabetically; a key of another kind ranks by kind
 * (numbers, then dates, then text, then blanks) and equal keys return 0 so the
 * caller's stable sort keeps their original order.
 */
export function compareSortValues(a, b) {
  const textA = typeof a === "string" ? a.trim() : "";
  const textB = typeof b === "string" ? b.trim() : "";
  const kindA = sortValueKind(textA);
  const kindB = sortValueKind(textB);
  if (kindA !== kindB) return KIND_RANK[kindA] - KIND_RANK[kindB];
  if (kindA === "number") return Number(textA) - Number(textB);
  if (kindA === "date") return Date.parse(textA) - Date.parse(textB);
  if (kindA === "text") return textA.localeCompare(textB);
  return 0;
}

/** True when `range` is a rectangle this worksheet can sort. */
export function isSortRange(range, rowCount, columnCount) {
  return (
    range !== null &&
    typeof range === "object" &&
    Number.isInteger(range.minRow) &&
    Number.isInteger(range.maxRow) &&
    Number.isInteger(range.minCol) &&
    Number.isInteger(range.maxCol) &&
    range.minRow >= 0 &&
    range.minCol >= 0 &&
    range.minRow <= range.maxRow &&
    range.minCol <= range.maxCol &&
    range.maxRow < rowCount &&
    range.maxCol < columnCount
  );
}

/**
 * Applies one sort to a worksheet, returning a new worksheet
 * (`{ok: true, worksheet}`) or a rejection (`{ok: false, error}`). The original
 * worksheet is never mutated, and a rejected sort leaves every cell untouched.
 */
export function sortRangeRecords(worksheet, spec) {
  const range = spec?.range;
  if (!isSortRange(range, worksheet.rowCount, worksheet.columnCount)) {
    return { ok: false, error: "Invalid sort range" };
  }
  const col = spec.col;
  if (!Number.isInteger(col) || col < range.minCol || col > range.maxCol) {
    return { ok: false, error: "The sort column is outside the selected range" };
  }
  const order = spec.order;
  if (!SORT_ORDERS.includes(order)) {
    return { ok: false, error: "Unknown sort order" };
  }

  const hasHeaderRow = spec.hasHeaderRow === true;
  const firstRow = range.minRow + (hasHeaderRow ? 1 : 0);
  const rows = [];
  for (let row = firstRow; row <= range.maxRow; row += 1) rows.push(row);
  const raw = (row) => worksheet.cells[cellCoordinate(row, col)] ?? "";
  // The row tiebreak keeps equal sort keys in their original relative order.
  const sorted = [...rows].sort((left, right) => {
    const result = compareSortValues(raw(left), raw(right));
    if (result !== 0) return order === "descending" ? -result : result;
    return left - right;
  });

  // Old row -> new row of the moved records, so a formula can follow the
  // records it referenced inside the range.
  const movedRow = new Map(sorted.map((row, index) => [row, firstRow + index]));
  const insideRange = (refCol, refRow) =>
    refCol >= range.minCol && refCol <= range.maxCol && refRow >= firstRow && refRow <= range.maxRow;

  const cells = { ...worksheet.cells };
  sorted.forEach((row, index) => {
    const target = firstRow + index;
    for (let column = range.minCol; column <= range.maxCol; column += 1) {
      const value = worksheet.cells[cellCoordinate(row, column)] ?? "";
      const key = cellCoordinate(target, column);
      if (value === "") {
        delete cells[key];
        continue;
      }
      cells[key] = mapFormulaRows(value, (refCol, refRow) =>
        insideRange(refCol, refRow) ? { col: refCol, row: movedRow.get(refRow) } : null,
      );
    }
  });

  return { ok: true, worksheet: { ...worksheet, cells } };
}

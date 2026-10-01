/**
 * Sorting one rectangular range of a worksheet by one of its columns (REQ-5-1-1).
 *
 * The request names the selected rectangle (`A1:C4`), the column inside it and the direction.
 * Only the data rows move — the header row, when the request declares one, stays on top — and
 * whole records move together: every column of the range travels with its row, so the values of
 * a record are never split. A moved formula keeps addressing its own row, exactly like a
 * spreadsheet that adjusts relative references while sorting (`translateFormulaText`).
 *
 * Sort keys are the displayed text of the sort column (the calculated result for a formula
 * cell). Numbers, parseable dates and text are compared inside their own type, blanks stay at
 * the end of both directions, and equal keys keep their original relative order because
 * `Array#sort` is stable.
 *
 * Cells outside the range, the filter view and the validation rules are never touched: they
 * keep addressing the same rectangle. A rejected request changes nothing, so the caller always
 * keeps the last successful order.
 */

import { cellAddress, parseAddress, rangeBounds } from "./address.mjs";
import { computeSheetValues } from "./formula.mjs";
import { translateFormulaText } from "./reference.mjs";
import { sheetColumnCount, sheetRowCount } from "./structure.mjs";

export const SORT_RANGE_INVALID_MESSAGE = "Invalid sort range";
export const SORT_COLUMN_INVALID_MESSAGE = "Invalid sort column";
export const SORT_ORDER_INVALID_MESSAGE = "Invalid sort order";

export const SORT_ORDERS = ["ascending", "descending"];

/** Type ranks of the comparable values; blanks sort after every filled value. */
const NUMBER_RANK = 0;
const DATE_RANK = 1;
const TEXT_RANK = 2;
const BLANK_RANK = 3;

const NUMBER_TEXT = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

function numericValue(text) {
  const trimmed = String(text ?? "").trim();
  return NUMBER_TEXT.test(trimmed) ? Number(trimmed) : null;
}

/** A text that names a calendar day; a plain number is never read as a date. */
function dateValue(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "" || NUMBER_TEXT.test(trimmed)) return null;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function rankOf(text) {
  if (String(text ?? "").trim() === "") return BLANK_RANK;
  if (numericValue(text) !== null) return NUMBER_RANK;
  if (dateValue(text) !== null) return DATE_RANK;
  return TEXT_RANK;
}

/** Ascending comparison of two keys of the same type (`-1`, `0` or `1`). */
function compareSameType(left, right, rank) {
  if (rank === NUMBER_RANK) return Math.sign(numericValue(left) - numericValue(right));
  if (rank === DATE_RANK) return Math.sign(dateValue(left) - dateValue(right));
  const a = String(left).toLowerCase();
  const b = String(right).toLowerCase();
  if (a !== b) return a < b ? -1 : 1;
  // Same ignoring case: keep the plain code-unit order so the result is deterministic.
  if (String(left) === String(right)) return 0;
  return String(left) < String(right) ? -1 : 1;
}

/**
 * Order of two sort keys. Numbers, dates and text keep their type order in ascending order
 * (and reversed in descending order), blanks stay last in both directions, and equal keys keep
 * their original relative order because the sort itself is stable.
 * @returns {number} negative when `left` comes first
 */
export function compareSortKeys(left, right, order) {
  const leftRank = rankOf(left);
  const rightRank = rankOf(right);
  if (leftRank === BLANK_RANK || rightRank === BLANK_RANK) {
    if (leftRank === rightRank) return 0;
    return leftRank === BLANK_RANK ? 1 : -1;
  }
  if (leftRank !== rightRank) {
    const byRank = leftRank - rightRank;
    return order === "descending" ? -byRank : byRank;
  }
  const compared = compareSameType(left, right, leftRank);
  // `0 - compared` keeps an equal pair at exactly `0` (never `-0`).
  return order === "descending" ? 0 - compared : compared;
}

/** 1-based column number of `A`, or null when the text is not a column name. */
function columnNumber(letters) {
  if (!/^[A-Z]+$/.test(letters)) return null;
  const position = parseAddress(`${letters}1`);
  return position ? position.column : null;
}

/**
 * Sorts the records of one range of `sheet` by one of the range's columns.
 *
 * @param {object} sheet worksheet to rewrite
 * @param {{ range?: unknown, column?: unknown, order?: unknown, hasHeader?: unknown }} payload
 *   `column` is the column letter inside `range`, `order` is `ascending` or `descending`, and
 *   `hasHeader` keeps the first row of the range on top instead of sorting it.
 * @returns {{ ok: true } | { ok: false, error: string }} mutating `sheet.cells` only on success
 */
export function sortWorksheetRange(sheet, payload) {
  const bounds = rangeBounds(payload?.range);
  if (!bounds) return { ok: false, error: SORT_RANGE_INVALID_MESSAGE };

  const letters = typeof payload?.column === "string" ? payload.column.trim().toUpperCase() : "";
  const column = columnNumber(letters);
  if (column === null || column < bounds.left || column > bounds.right) {
    return { ok: false, error: SORT_COLUMN_INVALID_MESSAGE };
  }

  const order = payload?.order;
  if (!SORT_ORDERS.includes(order)) return { ok: false, error: SORT_ORDER_INVALID_MESSAGE };

  const firstRow = payload?.hasHeader === true ? bounds.top + 1 : bounds.top;
  // A range that is only a header row has no record to move.
  if (firstRow > bounds.bottom) return { ok: true };

  const size = { rows: sheetRowCount(sheet), columns: sheetColumnCount(sheet) };
  const values = computeSheetValues(sheet.cells, size);
  const records = [];
  for (let row = firstRow; row <= bounds.bottom; row += 1) {
    records.push({ row, key: String(values[cellAddress(row, column)] ?? "") });
  }
  // `Array#sort` is stable, so records with equal keys keep their original relative order.
  const sorted = [...records].sort((left, right) =>
    compareSortKeys(left.key, right.key, order),
  );

  const inBand = (position) =>
    position.row >= firstRow &&
    position.row <= bounds.bottom &&
    position.column >= bounds.left &&
    position.column <= bounds.right;

  const cells = {};
  for (const [address, value] of Object.entries(sheet.cells ?? {})) {
    const position = parseAddress(address);
    if (!position || !inBand(position)) cells[address] = value;
  }
  sorted.forEach((record, index) => {
    const targetRow = firstRow + index;
    const rowDelta = targetRow - record.row;
    for (let current = bounds.left; current <= bounds.right; current += 1) {
      const raw = sheet.cells[cellAddress(record.row, current)] ?? "";
      if (raw === "") continue;
      // A moved formula follows its record and keeps pointing at its own row.
      cells[cellAddress(targetRow, current)] =
        typeof raw === "string" && raw.startsWith("=")
          ? translateFormulaText(raw, rowDelta, 0, size)
          : raw;
    }
  });

  sheet.cells = cells;
  return { ok: true };
}

/**
 * Sorting helpers shared by the `Sort range` dialog, the editor state and the test double.
 *
 * The authoritative sort lives in `backend/src/domain/sort.mjs`: the server moves the records
 * and returns the reordered worksheet. These helpers only name the dialog's options after the
 * header text of the selected rectangle, decide whether that rectangle looks like it starts
 * with a header row, and mirror the comparison rules so the test double answers like the server.
 */

import { columnName, parseAddress, selectionBounds, type CellSelection, type SelectionBounds } from "./spreadsheet";
import { cellText, type WorksheetState } from "./workbook";

export type SortOrder = "ascending" | "descending";

/** Options of the `Order` combo box, in the order the dialog lists them. */
export const SORT_ORDER_OPTIONS: readonly { value: SortOrder; label: string }[] = [
  { value: "ascending", label: "Ascending" },
  { value: "descending", label: "Descending" },
];

export interface SortColumnOption {
  /** Column letter inside the rectangle; the request submits this value. */
  value: string;
  /** Accessible name of the option: the header text of that column. */
  label: string;
}

/** What the `Sort` button submits for the selected rectangle. */
export interface SortRequest {
  range: string;
  column: string;
  order: SortOrder;
  hasHeader: boolean;
}

/** Bounds of a stored `A1:C4` range, or null when it is not usable. */
export function sortRangeBounds(range: string | undefined): SelectionBounds | null {
  if (!range) return null;
  const [start, end = start] = range.split(":");
  const from = parseAddress(start);
  const to = parseAddress(end);
  if (!from || !to) return null;
  return {
    top: Math.min(from.row, to.row),
    bottom: Math.max(from.row, to.row),
    left: Math.min(from.column, to.column),
    right: Math.max(from.column, to.column),
  };
}

/**
 * `Sort by` options of one selected rectangle: one entry per column, left to right, named
 * after the header text of the rectangle's first row (the column letter when it is empty).
 */
export function sortColumnOptions(
  sheet: WorksheetState | undefined,
  selection: CellSelection,
): SortColumnOption[] {
  const bounds = selectionBounds(selection);
  const options: SortColumnOption[] = [];
  for (let column = bounds.left; column <= bounds.right; column += 1) {
    const letter = columnName(column);
    const header = cellText(sheet, `${letter}${bounds.top + 1}`).trim();
    options.push({ value: letter, label: header === "" ? letter : header });
  }
  return options;
}

/**
 * True when the first row of the rectangle looks like a header row: it holds at least one cell
 * and every filled cell is text that is neither a number nor a date. The `Data has header row`
 * checkbox starts checked for such a rectangle, like a spreadsheet's own detection.
 */
export function looksLikeHeaderRow(
  sheet: WorksheetState | undefined,
  selection: CellSelection,
): boolean {
  const bounds = selectionBounds(selection);
  if (bounds.bottom === bounds.top) return false;
  let filled = 0;
  for (let column = bounds.left; column <= bounds.right; column += 1) {
    const text = cellText(sheet, `${columnName(column)}${bounds.top + 1}`).trim();
    if (text === "") continue;
    filled += 1;
    if (isNumericText(text) || isDateText(text)) return false;
  }
  return filled > 0;
}

const NUMBER_TEXT = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

/** True for a text a spreadsheet would read as a number. */
export function isNumericText(text: string): boolean {
  return NUMBER_TEXT.test(String(text ?? "").trim());
}

/** True for a text that names a calendar day; a plain number is never read as a date. */
export function isDateText(text: string): boolean {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "" || NUMBER_TEXT.test(trimmed)) return false;
  return Number.isFinite(Date.parse(trimmed));
}

const NUMBER_RANK = 0;
const DATE_RANK = 1;
const TEXT_RANK = 2;
const BLANK_RANK = 3;

function rankOf(text: string): number {
  if (String(text ?? "").trim() === "") return BLANK_RANK;
  if (isNumericText(text)) return NUMBER_RANK;
  if (isDateText(text)) return DATE_RANK;
  return TEXT_RANK;
}

/**
 * Mirror of the server's `compareSortKeys`: numbers, dates and text are compared inside their
 * own type, blanks stay last in both directions, and `descending` reverses the other keys.
 */
export function compareSortKeys(left: string, right: string, order: SortOrder): number {
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
  let compared: number;
  if (leftRank === NUMBER_RANK) compared = Math.sign(Number(left.trim()) - Number(right.trim()));
  else if (leftRank === DATE_RANK) compared = Math.sign(Date.parse(left.trim()) - Date.parse(right.trim()));
  else {
    const a = String(left).toLowerCase();
    const b = String(right).toLowerCase();
    compared = a === b ? (String(left) === String(right) ? 0 : String(left) < String(right) ? -1 : 1) : a < b ? -1 : 1;
  }
  if (compared === 0) return 0;
  // `0 - compared` keeps an equal pair at exactly `0` (never `-0`).
  return order === "descending" ? 0 - compared : compared;
}

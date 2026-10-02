import { displayValues } from "./formula";
import { cellName, columnLabel, type CellRegion, type Worksheet } from "./workbook";

/**
 * Client-side view of "Sort range" (REQ-5-1-1).
 *
 * The editor only builds the dialog: the options of `Sort by` are the header
 * texts of the selected range (the displayed text of its first row), `Order`
 * offers the two visible order names, and the checkbox decides whether that
 * first row stays out of the sort. The actual row permutation happens on the
 * server in one validated request, so a rejected sort keeps the grid order.
 */

export type SortOrder = "ascending" | "descending";

/** Payload of one sort request: the rectangle, its key column and the order. */
export interface SortRangeRequest {
  /** A1 text of the rectangle to sort (the region of the current selection). */
  range: string;
  /** Absolute 0-based column index of the key column. */
  column: number;
  order: SortOrder;
  /** When set, the first row of the range stays in place. */
  hasHeaderRow: boolean;
}

/** What the dialog collects; the editor adds the rectangle it was opened on. */
export type SortRangeOptions = Omit<SortRangeRequest, "range">;

/** Visible names of the order options, in the order the dialog lists them. */
export const SORT_ORDERS: readonly { value: SortOrder; label: string }[] = [
  { value: "ascending", label: "Ascending" },
  { value: "descending", label: "Descending" },
];

export interface SortColumnOption {
  /** Absolute 0-based column index, sent to the server as `column`. */
  value: string;
  /** Accessible name of the option: the header text of the column. */
  label: string;
}

/**
 * Options of the `Sort by` combo box: one per column of the selected range,
 * named after the header text of that column (the displayed text of the range's
 * first row). A column without header text falls back to its column label, so
 * every option stays identifiable.
 */
export function sortColumnOptions(worksheet: Worksheet, region: CellRegion): SortColumnOption[] {
  const display = displayValues(worksheet);
  const options: SortColumnOption[] = [];
  for (let col = region.minCol; col <= region.maxCol; col += 1) {
    const header = (display[cellName({ row: region.minRow, col })] ?? "").trim();
    options.push({ value: String(col), label: header || columnLabel(col) });
  }
  return options;
}

/** Plain decimal text (optionally signed/exponent): the number type probe. */
const NUMBER_TEXT = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function isNumericText(text: string): boolean {
  return NUMBER_TEXT.test(text);
}

function isDateText(text: string): boolean {
  return Number.isFinite(Date.parse(text));
}

/**
 * Initial state of the "Data has header row" checkbox, mirroring the
 * spreadsheet auto-detection: the first row of the range is read as a header
 * (and therefore kept out of the sort) when the range has data rows below it
 * and every non-empty cell of that row is plain text — a row with numbers or
 * dates in it is data.
 */
export function regionHasHeaderRow(worksheet: Worksheet, region: CellRegion): boolean {
  if (region.maxRow <= region.minRow) return false;
  const display = displayValues(worksheet);
  let seen = false;
  for (let col = region.minCol; col <= region.maxCol; col += 1) {
    const text = (display[cellName({ row: region.minRow, col })] ?? "").trim();
    if (!text) continue;
    seen = true;
    if (isNumericText(text) || isDateText(text)) return false;
  }
  return seen;
}

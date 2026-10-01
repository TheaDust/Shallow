import {
  cellCoordinate,
  columnIndex,
  columnLabel,
  normalizeRange,
  type CellRange,
} from "./spreadsheet";

/**
 * Sort dialog of one rectangular range (REQ-5-1-1). The dialog only describes the request; the
 * worksheet itself is re-ordered by the server, which moves whole records by row and leaves every
 * cell outside the selected range untouched.
 */
export const SORT_ORDERS = ["ascending", "descending"] as const;

export type SortOrder = (typeof SORT_ORDERS)[number];

/** Visible names of the `Order` combo box options, in the order the dialog offers them. */
export const ORDER_LABELS: Record<SortOrder, string> = {
  ascending: "Ascending",
  descending: "Descending",
};

export interface SortColumnOption {
  /** Column letter, the value the request names the sort column by. */
  value: string;
  /** Accessible name of the option: the header text of the column. */
  label: string;
}

/** Header text of one column of the range: the displayed value of the range's first row. */
export function sortHeaderText(
  cells: Record<string, string>,
  range: CellRange,
  column: string,
): string {
  const bounds = normalizeRange({ anchor: range.start, focus: range.end });
  const index = columnIndex(column);
  if (index < 0 || index < bounds.minColumn || index > bounds.maxColumn) return "";
  return (cells[cellCoordinate(bounds.minRow, index)] ?? "").trim();
}

/**
 * One option per column of the selected range, named by the header text of that column. A column
 * whose first cell is empty has no header text to name it by, so it falls back to its letter.
 */
export function sortColumnOptions(
  cells: Record<string, string>,
  range: CellRange,
): SortColumnOption[] {
  const bounds = normalizeRange({ anchor: range.start, focus: range.end });
  const options: SortColumnOption[] = [];
  for (let column = bounds.minColumn; column <= bounds.maxColumn; column += 1) {
    const label = columnLabel(column);
    const header = sortHeaderText(cells, range, label);
    options.push({ value: label, label: header === "" ? label : header });
  }
  return options;
}

/** Whether the range holds more than one row, so sorting it can change the order at all. */
export function sortableRange(range: CellRange): boolean {
  const bounds = normalizeRange({ anchor: range.start, focus: range.end });
  return bounds.maxRow > bounds.minRow;
}

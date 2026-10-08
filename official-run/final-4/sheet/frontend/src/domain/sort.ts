/**
 * Client-side helpers for sorting a selected range.
 *
 * The reorder itself is performed and persisted by the server (the
 * authoritative boundary); the editor only describes the dialog: the sort
 * orders it offers and the per-column options of a selected rectangle.
 */

import { cellName, columnName, type CellRegion } from "./grid";

export type SortOrder = "asc" | "desc";

/** Options of the dialog's "Order" combo box, in display order. */
export const SORT_ORDER_OPTIONS: ReadonlyArray<{ value: SortOrder; label: string }> = [
  { value: "asc", label: "Ascending" },
  { value: "desc", label: "Descending" },
];

/** One selectable column of the "Sort by" combo box. */
export interface SortColumn {
  /** Absolute 1-based column inside the sorted range. */
  column: number;
  /** Accessible name of the option: the range's header text of that column. */
  label: string;
}

/**
 * Options of the "Sort by" combo box for a range, one per column. The option
 * name is the header text of the range's first row; a column without a header
 * falls back to its column letter so every column stays selectable.
 */
export function sortColumns(values: Record<string, string>, region: CellRegion): SortColumn[] {
  const columns: SortColumn[] = [];
  for (let column = region.left; column <= region.right; column += 1) {
    const header = values[cellName(region.top, column)] ?? "";
    columns.push({ column, label: header !== "" ? header : columnName(column) });
  }
  return columns;
}

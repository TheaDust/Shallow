import { columnIndexToLabel, makeCellId, type CellRegion } from "../lib/cells";
import { displayedCellText } from "../workbooks/cells";
import type { SortOrder, WorksheetData } from "../workbooks/types";

/**
 * Pure helpers of the `Sort range` dialog (REQ-5-1-1): the `Sort by` options name the columns of
 * the selected range by the header text of their first row, and the header checkbox starts checked
 * when that first row reads like a header row rather than like a record.
 */

export const SORT_ORDER_OPTIONS: readonly { value: SortOrder; label: string }[] = [
  { value: "ascending", label: "Ascending" },
  { value: "descending", label: "Descending" },
];

export interface SortColumnOption {
  /** Value of the option: the worksheet column index as text. */
  value: string;
  /** Visible name of the option: the header text of the column (its letter when it is empty). */
  label: string;
  column: number;
}

/** Options of `Sort by`: one per column of the range, named by the header text of that column. */
export function sortColumnOptions(worksheet: WorksheetData, region: CellRegion): SortColumnOption[] {
  const options: SortColumnOption[] = [];
  for (let column = region.left; column <= region.right; column += 1) {
    const header = displayedCellText(worksheet, makeCellId(region.top, column));
    options.push({ value: String(column), column, label: header === "" ? columnIndexToLabel(column) : header });
  }
  return options;
}

/** True when the first row of the range holds a text in every column, so it reads as headers. */
export function looksLikeHeaderRow(worksheet: WorksheetData, region: CellRegion): boolean {
  if (region.bottom <= region.top) return false;
  for (let column = region.left; column <= region.right; column += 1) {
    const text = displayedCellText(worksheet, makeCellId(region.top, column)).trim();
    if (text === "" || Number.isFinite(Number(text))) return false;
  }
  return true;
}

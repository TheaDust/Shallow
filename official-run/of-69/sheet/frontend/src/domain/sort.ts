import { parseRange } from "./filter";
import { cellDisplayText, cellName, columnLabel, type Worksheet } from "./types";

/** Sort orders offered by the "Order" combo box of the "Sort range" dialog (REQ-5-1-1). */
export type SortOrder = "ascending" | "descending";

export const SORT_ORDER_OPTIONS: ReadonlyArray<{ value: SortOrder; label: string }> = [
  { value: "ascending", label: "Ascending" },
  { value: "descending", label: "Descending" },
];

export interface SortColumnOption {
  /** Absolute 0-based worksheet column the option sorts by. */
  column: number;
  /** Accessible name of the option: the header text of that column. */
  label: string;
}

/**
 * One "Sort by" option per column of the selected range, named after the header text of
 * the range's first row. A blank header falls back to the column letter so the option
 * still has a stable accessible name.
 */
export function sortColumnOptions(worksheet: Worksheet, range: string): SortColumnOption[] {
  const bounds = parseRange(range);
  if (!bounds) return [];
  const options: SortColumnOption[] = [];
  for (let column = bounds.left; column <= bounds.right; column += 1) {
    const header = cellDisplayText(worksheet, cellName(bounds.top, column)).trim();
    options.push({ column, label: header !== "" ? header : columnLabel(column) });
  }
  return options;
}

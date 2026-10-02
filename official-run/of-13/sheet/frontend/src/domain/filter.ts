/**
 * Filter view helpers shared by the grid, the filter dialog and the test double.
 *
 * The authoritative rule lives in `backend/src/domain/filter.mjs`: the server stores the
 * definition and returns the hidden row numbers on every response, so the editor only has to
 * render what it receives. These helpers derive the dialog's inputs (the data region, the
 * header text and the distinct source values) and mirror the condition wording so a double can
 * answer the same way.
 */

import { worksheetUsedRange } from "./csv";
import { cellAddress, columnName, parseAddress, type SelectionBounds } from "./spreadsheet";
import { cellText, type ColumnFilter, type FilterCondition, type WorksheetFilter } from "./workbook";
import type { WorksheetState } from "./workbook";

export interface ConditionOption {
  /** `none` keeps the value selection; every other entry is a stored condition. */
  value: FilterCondition | "none";
  label: string;
}

/** Options of the `Condition` combo box, in the order the dialog lists them. */
export const CONDITION_OPTIONS: readonly ConditionOption[] = [
  { value: "none", label: "None" },
  { value: "text-contains", label: "Text contains" },
  { value: "greater-than", label: "Greater than" },
  { value: "before", label: "Before" },
  { value: "is-empty", label: "Is empty" },
  { value: "is-not-empty", label: "Is not empty" },
];

/** True for the conditions that read the `Value` text box. */
export function conditionNeedsValue(condition: FilterCondition | "none"): boolean {
  return condition === "text-contains" || condition === "greater-than" || condition === "before";
}

/** Rectangle of a stored `A1:C4` range, or null when it is not usable. */
export function filterRangeBounds(range: string | undefined): SelectionBounds | null {
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
 * Data region of a worksheet: the used range from `A1`, which is what `Create filter` covers.
 * Returns null for a worksheet without any value.
 */
export function filterRangeOf(sheet: WorksheetState | undefined): string | null {
  const { rowCount, columnCount } = worksheetUsedRange(sheet);
  if (rowCount === 0 || columnCount === 0) return null;
  return `A1:${columnName(columnCount - 1)}${rowCount}`;
}

/** Column letters of a filter range, left to right. */
export function filterColumnsOf(filter: WorksheetFilter | undefined): string[] {
  const bounds = filterRangeBounds(filter?.range);
  if (!bounds) return [];
  const columns: string[] = [];
  for (let column = bounds.left; column <= bounds.right; column += 1) {
    columns.push(columnName(column));
  }
  return columns;
}

/** Text of the header cell (`Region`, `Sales`, …) a filter button is named after. */
export function filterHeaderText(
  sheet: WorksheetState,
  filter: WorksheetFilter | undefined,
  column: string,
): string {
  const bounds = filterRangeBounds(filter?.range);
  if (!bounds) return column;
  const text = cellText(sheet, `${column}${bounds.top + 1}`).trim();
  return text === "" ? column : text;
}

/** Distinct displayed values of the data rows of one column, in order of first appearance. */
export function distinctColumnValues(
  sheet: WorksheetState,
  filter: WorksheetFilter | undefined,
  column: string,
): string[] {
  const bounds = filterRangeBounds(filter?.range);
  if (!bounds) return [];
  const values: string[] = [];
  for (let row = bounds.top + 1; row <= bounds.bottom; row += 1) {
    const text = cellText(sheet, `${column}${row + 1}`);
    if (text !== "" && !values.includes(text)) values.push(text);
  }
  return values;
}

/** Stored filter of one column, when it has one. */
export function columnFilterOf(
  filter: WorksheetFilter | undefined,
  column: string,
): ColumnFilter | undefined {
  return filter?.columns.find((entry) => entry.column === column.toUpperCase());
}

/** True when the server reported this 1-based row as hidden by the filter. */
export function isRowHidden(sheet: WorksheetState | undefined, row: number): boolean {
  return (sheet?.hiddenRows ?? []).includes(row);
}

/** 1-based column number of A1 letters. */
export function columnIndexOf(letters: string): number {
  let column = 0;
  for (const letter of letters.toUpperCase()) {
    column = column * 26 + (letter.charCodeAt(0) - 64);
  }
  return column;
}

/** 1-based rows a stored filter would hide; the server sends the same list as `hiddenRows`. */
export function hiddenRowsOf(sheet: WorksheetState | undefined): number[] {
  const filter = sheet?.filter;
  const bounds = filterRangeBounds(filter?.range);
  if (!filter || !bounds || (filter.columns ?? []).length === 0) return [];
  const hidden: number[] = [];
  for (let row = bounds.top + 1; row <= bounds.bottom; row += 1) {
    for (const entry of filter.columns) {
      const index = columnIndexOf(entry.column) - 1;
      if (index < bounds.left || index > bounds.right) continue;
      const text = cellText(sheet, cellAddress(row, index));
      if (!columnFilterMatches(text, entry)) {
        hidden.push(row + 1);
        break;
      }
    }
  }
  return hidden;
}

/**
 * Mirror of the server's condition check: it makes the test double answer exactly like the
 * authoritative `domain/filter.mjs` and is also used to keep the dialog's preview honest.
 */
export function matchesFilterCondition(
  text: string,
  condition: FilterCondition | undefined,
  value: string | undefined,
): boolean {
  const source = String(text ?? "");
  const operand = String(value ?? "").trim();
  if (condition === "text-contains") return source.toLowerCase().includes(operand.toLowerCase());
  if (condition === "greater-than") {
    const cell = Number(source.trim());
    const limit = Number(operand);
    return Number.isFinite(cell) && Number.isFinite(limit) && cell > limit;
  }
  if (condition === "before") {
    const cell = Date.parse(source.trim());
    const limit = Date.parse(operand);
    return Number.isFinite(cell) && Number.isFinite(limit) && cell < limit;
  }
  if (condition === "is-empty") return source.trim() === "";
  if (condition === "is-not-empty") return source.trim() !== "";
  return true;
}

/** One column matches when its stored values or its condition accept the displayed text. */
export function columnFilterMatches(text: string, entry: ColumnFilter): boolean {
  if (entry.mode === "values") return (entry.values ?? []).includes(text);
  if (entry.mode === "condition") return matchesFilterCondition(text, entry.condition, entry.value);
  return true;
}

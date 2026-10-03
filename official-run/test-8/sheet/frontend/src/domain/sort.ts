import { evaluateCells } from "./formula";
import { cellCoordinate, columnLabel } from "./grid";
import { mapFormulaRows } from "./references";
import type { CellRange, SortOrder, SortRangeSpec, Worksheet } from "./types";

/**
 * Frontend twin of `backend/src/domain/sort.mjs`.
 *
 * The server is the authority: it reorders the stored records in one write.
 * This mirror drives the "Sort range" dialog (its combo box options) and lets
 * the test double behave exactly like the API, so both runtimes must stay
 * behaviour-compatible — change one and change the other.
 */

export const SORT_ORDERS: readonly SortOrder[] = ["ascending", "descending"];

/** The order a dialog starts with. */
export const DEFAULT_SORT_ORDER: SortOrder = "ascending";

/** Options of the "Order" combo box, with their required accessible names. */
export const SORT_ORDER_OPTIONS: ReadonlyArray<{ value: SortOrder; label: string }> = [
  { value: "ascending", label: "Ascending" },
  { value: "descending", label: "Descending" },
];

const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Text shapes recognized as dates: ISO, `d/m/y` and `d-Mon-y`. */
const DATE_PATTERNS = [
  /^\d{4}-\d{1,2}-\d{1,2}(?:[T ][0-9:.]+.*)?$/,
  /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
  /^\d{1,2}-[A-Za-z]{3,}-\d{2,4}$/,
];

const KIND_RANK: Record<string, number> = { number: 0, date: 1, text: 2, blank: 3 };

/** True when the trimmed text is a parseable date (ISO, `d/m/y`, `d-Mon-y`). */
export function isDateText(text: string): boolean {
  return DATE_PATTERNS.some((pattern) => pattern.test(text)) && Number.isFinite(Date.parse(text));
}

/** Comparison class of one sort key: `number`, `date`, `text` or `blank`. */
export function sortValueKind(raw: string | undefined): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") return "blank";
  if (NUMBER_PATTERN.test(text)) return "number";
  if (isDateText(text)) return "date";
  return "text";
}

/**
 * Compares two sort keys by their respective types: numbers numerically, dates
 * chronologically, text alphabetically; other kinds rank by kind (numbers,
 * dates, text, blanks) and equal keys return 0 so the caller's stable sort
 * keeps their original relative order.
 */
export function compareSortValues(a: string | undefined, b: string | undefined): number {
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
export function isSortRange(
  range: CellRange | null | undefined,
  rowCount: number,
  columnCount: number,
): range is CellRange {
  return (
    range !== null &&
    range !== undefined &&
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
 * The "Sort by" options of a selected range: one per selected column, named
 * after the header text of the range's first row (the column letter when that
 * header cell is empty), valued by the column index.
 */
export function sortColumnOptions(
  worksheet: Worksheet,
  range: CellRange,
): Array<{ value: string; label: string }> {
  const display = evaluateCells(worksheet.cells);
  const options: Array<{ value: string; label: string }> = [];
  for (let col = range.minCol; col <= range.maxCol; col += 1) {
    const text = (display[cellCoordinate(range.minRow, col)] ?? "").trim();
    options.push({ value: String(col), label: text !== "" ? text : columnLabel(col) });
  }
  return options;
}

export type SortResult = { ok: true; worksheet: Worksheet } | { ok: false; error: string };

/**
 * Applies one sort to a worksheet, returning a new worksheet or a rejection.
 * The original worksheet is never mutated, the header row of the range is
 * skipped when `hasHeaderRow` is set, records move together row by row, cells
 * outside the rectangle keep their values and equal keys keep their order.
 */
export function sortRangeRecords(worksheet: Worksheet, spec: SortRangeSpec): SortResult {
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
  const rows: number[] = [];
  for (let row = firstRow; row <= range.maxRow; row += 1) rows.push(row);
  const raw = (row: number) => worksheet.cells[cellCoordinate(row, col)] ?? "";
  const sorted = [...rows].sort((left, right) => {
    const result = compareSortValues(raw(left), raw(right));
    if (result !== 0) return order === "descending" ? -result : result;
    return left - right;
  });

  const movedRow = new Map(sorted.map((row, index) => [row, firstRow + index]));
  const insideRange = (refCol: number, refRow: number) =>
    refCol >= range.minCol && refCol <= range.maxCol && refRow >= firstRow && refRow <= range.maxRow;

  const cells: Record<string, string> = { ...worksheet.cells };
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
        insideRange(refCol, refRow) ? { col: refCol, row: movedRow.get(refRow) ?? refRow } : null,
      );
    }
  });

  return { ok: true, worksheet: { ...worksheet, cells } };
}

import { MAX_COLUMN_INDEX, MAX_ROW_INDEX } from "./fakeFormula";
import { cellId, parseAddress } from "./fakeStructure";
import type { CellRegion } from "../lib/cells";
import type { SortOrder, WorksheetData } from "../workbooks/types";

/**
 * Mirror of `backend/src/lib/sort.mjs` for the frontend tests: the rows of a rectangular range are
 * reordered as whole records, a header row and every cell outside the range stay where they are, and
 * a formula moves with its row while its references to cells of the sorted range follow them.
 */

export interface SortChangeInput {
  region: CellRegion;
  column: number;
  order: SortOrder;
  hasHeader: boolean;
}

const NUMBER_LITERAL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const DATE_LIKE = /^\d{4}-\d{1,2}-\d{1,2}([T ][\d:.]+)?$/;

function parseSortNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!NUMBER_LITERAL.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function parseSortDate(text: string): number | null {
  const trimmed = text.trim();
  if (!DATE_LIKE.test(trimmed)) return null;
  const value = Date.parse(trimmed);
  return Number.isNaN(value) ? null : value;
}

function compareText(left: string, right: string): number {
  const leftLower = left.toLowerCase();
  const rightLower = right.toLowerCase();
  if (leftLower < rightLower) return -1;
  if (leftLower > rightLower) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Compares two cell texts by type: numbers first, then dates, otherwise as text. */
export function compareCellText(left: string, right: string): number {
  const leftNumber = parseSortNumber(left);
  const rightNumber = parseSortNumber(right);
  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber === rightNumber ? 0 : leftNumber < rightNumber ? -1 : 1;
  }
  const leftDate = parseSortDate(left);
  const rightDate = parseSortDate(right);
  if (leftDate !== null && rightDate !== null) {
    return leftDate === rightDate ? 0 : leftDate < rightDate ? -1 : 1;
  }
  return compareText(left, right);
}

function sortKeyOf(worksheet: WorksheetData, row: number, column: number): string {
  const cell = worksheet.cells[cellId(row, column)];
  if (!cell) return "";
  return cell.display ?? cell.value ?? "";
}

/** Reads the payload of the sort request, or the message the fake server answers with. */
export function readFakeSortChange(
  worksheet: WorksheetData,
  payload: Record<string, unknown>,
): SortChangeInput | { error: string } {
  const raw = payload.range as CellRegion | string | undefined;
  let region: CellRegion | null = null;
  if (typeof raw === "string") {
    const parts = raw.trim().split(":");
    if (parts.length <= 2) {
      const start = parseAddress(parts[0] ?? "");
      const end = parts.length === 2 ? parseAddress(parts[1]) : start;
      if (start && end) {
        region = {
          top: Math.min(start.row, end.row),
          bottom: Math.max(start.row, end.row),
          left: Math.min(start.column, end.column),
          right: Math.max(start.column, end.column),
        };
      }
    }
  } else if (raw) {
    region = { top: raw.top, bottom: raw.bottom, left: raw.left, right: raw.right };
  }
  if (!region) return { error: "Enter a valid range such as A1:B2" };
  const column = Number(payload.column);
  if (!Number.isInteger(column) || column < region.left || column > region.right) {
    return { error: "The sorted column is outside the selected range" };
  }
  const order = String(payload.order ?? "").trim().toLowerCase();
  if (order !== "ascending" && order !== "descending") return { error: "Unknown sort order" };
  return { region, column, order, hasHeader: payload.hasHeader === true };
}

/** Rewrites the references of a formula through the row mapping of the sorted range. */
function remapFormula(text: string, mapRow: (row: number) => number | null): string {
  if (!(text.length > 1 && text.startsWith("="))) return text;
  return `=${text.slice(1).replace(/(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]{0,6})(?![A-Za-z0-9_])/g, (match, columnDollar, columnLabel, rowDollar, rowText) => {
    let column = 0;
    for (const character of String(columnLabel).toUpperCase()) column = column * 26 + (character.charCodeAt(0) - 64);
    const mapped = mapRow(Number(rowText));
    const row = mapped === null ? Number(rowText) : mapped;
    if (row < 1 || row > MAX_ROW_INDEX || column < 1 || column > MAX_COLUMN_INDEX) return "#REF!";
    let label = "";
    for (let rest = column; rest > 0; rest = Math.floor((rest - 1) / 26)) {
      label = String.fromCharCode(65 + ((rest - 1) % 26)) + label;
    }
    return `${columnDollar}${label}${rowDollar}${row}`;
  })}`;
}

/** Reorders the rows of the range; the caller recalculates the displays afterwards. */
export function applyFakeSort(worksheet: WorksheetData, change: SortChangeInput): void {
  const { region, column, order, hasHeader } = change;
  const firstRow = hasHeader ? region.top + 1 : region.top;
  if (firstRow > region.bottom) return;

  const entries: { row: number; index: number; key: string }[] = [];
  for (let row = firstRow; row <= region.bottom; row += 1) {
    entries.push({ row, index: entries.length, key: sortKeyOf(worksheet, row, column) });
  }
  entries.sort((left, right) => {
    const leftBlank = left.key.trim() === "";
    const rightBlank = right.key.trim() === "";
    if (leftBlank !== rightBlank) return leftBlank ? 1 : -1;
    if (leftBlank && rightBlank) return left.index - right.index;
    const comparison = compareCellText(left.key, right.key);
    if (comparison !== 0) return order === "descending" ? -comparison : comparison;
    return left.index - right.index;
  });

  const movedTo = new Map<number, number>();
  entries.forEach((entry, position) => movedTo.set(entry.row, firstRow + position));
  const mapRow = (row: number) => (movedTo.has(row) ? (movedTo.get(row) as number) : null);

  const writes: { cellId: string; value: string }[] = [];
  entries.forEach((entry, position) => {
    const targetRow = firstRow + position;
    for (let cellColumn = region.left; cellColumn <= region.right; cellColumn += 1) {
      const value = worksheet.cells[cellId(entry.row, cellColumn)]?.value ?? "";
      writes.push({ cellId: cellId(targetRow, cellColumn), value: remapFormula(value, mapRow) });
    }
  });

  for (const write of writes) {
    if (write.value === "") delete worksheet.cells[write.cellId];
    else worksheet.cells[write.cellId] = { value: write.value };
  }
}

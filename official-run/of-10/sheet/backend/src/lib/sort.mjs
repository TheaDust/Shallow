import { clampRegion, makeCellId, parseRegionRef } from "./cells.mjs";
import { WorkbookError } from "./errors.mjs";
import { computeWorksheetCells, remapFormulaReferences } from "./formula.mjs";

/**
 * Sorting one rectangular range of a worksheet (REQ-5-1-1). The rows of the range are reordered
 * as whole records: every value of a row moves with it, the cells outside the range keep their
 * coordinates and values, and the row a header row occupies (`hasHeader`) is left alone. Cells are
 * only reordered, never deleted, so the filter view, the validation rules and a pivot summary of
 * the same region keep reading the same coordinates.
 *
 * Sort keys are the displayed texts of the sort column: two numbers compare as numbers, two
 * parseable dates as dates, anything else as text. Blank keys sort after every other key in both
 * directions, equal keys keep their original relative order, and a formula moves with its row while
 * its references to cells of the sorted range follow the rows they point at.
 */

export const SORT_ORDERS = Object.freeze(["ascending", "descending"]);

const NUMBER_LITERAL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const DATE_LIKE = /^\d{4}-\d{1,2}-\d{1,2}([T ][\d:.]+)?$/;

function parseSortNumber(text) {
  const trimmed = text.trim();
  if (!NUMBER_LITERAL.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function parseSortDate(text) {
  const trimmed = text.trim();
  if (!DATE_LIKE.test(trimmed)) return null;
  const value = Date.parse(trimmed);
  return Number.isNaN(value) ? null : value;
}

/** Deterministic text order independent of the runtime locale: ignores case, then compares codes. */
function compareText(left, right) {
  const leftLower = left.toLowerCase();
  const rightLower = right.toLowerCase();
  if (leftLower < rightLower) return -1;
  if (leftLower > rightLower) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Compares two cell texts by their type: both numbers first, then both parseable dates, otherwise
 * as text. Keys that are not comparable as the same type fall back to the text order.
 */
export function compareCellText(left, right) {
  const leftText = String(left ?? "");
  const rightText = String(right ?? "");
  const leftNumber = parseSortNumber(leftText);
  const rightNumber = parseSortNumber(rightText);
  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber === rightNumber ? 0 : leftNumber < rightNumber ? -1 : 1;
  }
  const leftDate = parseSortDate(leftText);
  const rightDate = parseSortDate(rightText);
  if (leftDate !== null && rightDate !== null) {
    return leftDate === rightDate ? 0 : leftDate < rightDate ? -1 : 1;
  }
  return compareText(leftText, rightText);
}

/** Text a sort key reads: the displayed value of the cell (a formula uses its result). */
function sortKeyOf(worksheet, row, column) {
  const cell = worksheet.cells[makeCellId(row, column)];
  if (!cell) return "";
  return typeof cell.display === "string" ? cell.display : cell.value ?? "";
}

/** Normalizes the payload of the sort endpoint into the stored operation, or refuses it. */
export function readSortChange(worksheet, payload) {
  const requested = parseRegionRef(payload?.range);
  if (!requested) throw new WorkbookError("Enter a valid range such as A1:B2");
  const rowCount = Number.isInteger(worksheet?.rowCount) ? worksheet.rowCount : requested.bottom;
  const columnCount = Number.isInteger(worksheet?.columnCount) ? worksheet.columnCount : requested.right;
  const region = clampRegion(requested, rowCount, columnCount);

  const column = Number(payload?.column);
  if (!Number.isInteger(column) || column < region.left || column > region.right) {
    throw new WorkbookError("The sorted column is outside the selected range");
  }
  const order = String(payload?.order ?? "").trim().toLowerCase();
  if (!SORT_ORDERS.includes(order)) throw new WorkbookError("Unknown sort order");
  return { region, column, order, hasHeader: payload?.hasHeader === true };
}

/** The rows of the range that participate in the sort, in the order the sort puts them. */
export function sortedRows(worksheet, change) {
  const { region, column, order, hasHeader } = change;
  const firstRow = hasHeader ? region.top + 1 : region.top;
  const entries = [];
  for (let row = firstRow; row <= region.bottom; row += 1) {
    entries.push({ row, index: entries.length, key: sortKeyOf(worksheet, row, column) });
  }
  entries.sort((left, right) => {
    const leftBlank = left.key.trim() === "";
    const rightBlank = right.key.trim() === "";
    // A blank key follows every other key in both directions, like a spreadsheet sorts blanks.
    if (leftBlank !== rightBlank) return leftBlank ? 1 : -1;
    if (leftBlank && rightBlank) return left.index - right.index;
    const comparison = compareCellText(left.key, right.key);
    if (comparison !== 0) return order === "descending" ? -comparison : comparison;
    return left.index - right.index;
  });
  return entries.map((entry) => entry.row);
}

/**
 * Applies one sort to a worksheet: the whole range is rewritten so every participating row carries
 * its record to its new row, the header row and every cell outside the range stay where they are,
 * and the displays of the moved formulas are recalculated.
 */
export function applySortChange(worksheet, change) {
  const { region, hasHeader } = change;
  const firstRow = hasHeader ? region.top + 1 : region.top;
  if (firstRow > region.bottom) return;

  const order = sortedRows(worksheet, change);
  const movedTo = new Map();
  order.forEach((sourceRow, position) => movedTo.set(sourceRow, firstRow + position));
  const mapReference = (reference) => {
    if (reference.column < region.left || reference.column > region.right) return reference;
    const moved = movedTo.get(reference.row);
    return moved === undefined ? reference : { row: moved, column: reference.column };
  };

  const writes = [];
  order.forEach((sourceRow, position) => {
    const targetRow = firstRow + position;
    for (let column = region.left; column <= region.right; column += 1) {
      const value = worksheet.cells[makeCellId(sourceRow, column)]?.value ?? "";
      writes.push({ cellId: makeCellId(targetRow, column), value: remapFormulaReferences(value, mapReference) });
    }
  });

  for (const write of writes) {
    if (write.value === "") delete worksheet.cells[write.cellId];
    else worksheet.cells[write.cellId] = { value: write.value };
  }
  worksheet.cells = computeWorksheetCells(worksheet.cells);
}

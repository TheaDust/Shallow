import {
  DEFAULT_COLUMN_COUNT,
  DEFAULT_ROW_COUNT,
  makeCellId,
  parseCellId,
  readRegion,
} from "./cells.mjs";
import { WorkbookError } from "./errors.mjs";
import { computeWorksheetCells, remapFormulaReferences } from "./formula.mjs";

/**
 * Row and column structure changes of one worksheet (REQ-2-2). Inserting or deleting a row/column
 * moves the complete records of the worksheet: cells, formula references, validation rules, the
 * filter view and the stored selection all follow the same shift, so a record keeps its values and
 * the rules that covered it. Content is either moved or removed as a whole; a reference to a removed
 * row or column becomes `#REF!`. Only the worksheet that is changed is touched.
 */

export const ROW_AXIS = "row";
export const COLUMN_AXIS = "column";
export const INSERT = "insert";
export const DELETE = "delete";

const MISSING_ROW_MESSAGE = "The row is outside the worksheet";
const MISSING_COLUMN_MESSAGE = "The column is outside the worksheet";

/** Reads and checks the payload of a structure change against the worksheet it applies to. */
export function readStructureChange(worksheet, payload) {
  const requestedAxis = payload?.axis;
  const axis = requestedAxis === ROW_AXIS || requestedAxis === COLUMN_AXIS ? requestedAxis : null;
  if (!axis) throw new WorkbookError("Unknown structure change");
  const requestedOp = payload?.op;
  const op = requestedOp === INSERT || requestedOp === DELETE ? requestedOp : null;
  if (!op) throw new WorkbookError("Unknown structure change");

  const index = Number(payload?.index);
  const count = axis === ROW_AXIS ? sheetRowCount(worksheet) : sheetColumnCount(worksheet);
  if (!Number.isInteger(index) || index < 1 || index > count) {
    throw new WorkbookError(axis === ROW_AXIS ? MISSING_ROW_MESSAGE : MISSING_COLUMN_MESSAGE);
  }
  const side = payload?.side === "after" ? "after" : "before";
  return { axis, op, index, side };
}

function sheetRowCount(worksheet) {
  return Number.isInteger(worksheet?.rowCount) ? worksheet.rowCount : DEFAULT_ROW_COUNT;
}

function sheetColumnCount(worksheet) {
  return Number.isInteger(worksheet?.columnCount) ? worksheet.columnCount : DEFAULT_COLUMN_COUNT;
}

/** Index a row or column moves to: an insertion before `index` moves `index` and everything after. */
function insertBoundary(index, side) {
  return side === "after" ? index + 1 : index;
}

/** New index of one row/column after the change, or null when the change removed it. */
export function movedIndex(op, index, side, value) {
  if (op === INSERT) {
    const boundary = insertBoundary(index, side);
    return value >= boundary ? value + 1 : value;
  }
  if (value === index) return null;
  return value > index ? value - 1 : value;
}

/**
 * New index of the first edge of a range that follows the moved rows (`top`/`left`): the rows of a
 * rule keep being constrained, so an edge above the change keeps its place while a removed edge
 * stays on the index the following row moved up to.
 */
export function movedStart(op, index, side, value) {
  if (op === INSERT) return movedIndex(op, index, side, value);
  return value > index ? value - 1 : value;
}

/** New index of the last edge of a range (`bottom`/`right`); a removed edge ends one row earlier. */
export function movedEnd(op, index, side, value) {
  if (op === INSERT) return movedIndex(op, index, side, value);
  return value >= index ? value - 1 : value;
}

/** Removes every cell of the removed row or column and moves the remaining ones to their new place. */
function applyToCells(worksheet, moveRow, moveColumn) {
  const cells = {};
  for (const [cellId, cell] of Object.entries(worksheet.cells ?? {})) {
    const address = parseCellId(cellId);
    if (!address) continue;
    const row = moveRow(address.row);
    const column = moveColumn(address.column);
    if (row === null || column === null) continue;
    const value = typeof cell?.value === "string" ? cell.value : "";
    if (value === "") continue;
    const text = remapFormulaReferences(value, (reference) => {
      const nextRow = moveRow(reference.row);
      const nextColumn = moveColumn(reference.column);
      if (nextRow === null || nextColumn === null) return null;
      return { row: nextRow, column: nextColumn };
    });
    cells[makeCellId(row, column)] = { value: text };
  }
  worksheet.cells = computeWorksheetCells(cells);
}

/** Moves the validation rules with their rows/columns; a rule whose rows are all removed is dropped. */
function applyToValidations(worksheet, isRow, moveStart, moveEnd) {
  const rules = Array.isArray(worksheet.validations) ? worksheet.validations : [];
  worksheet.validations = rules.map((rule) => ({
    ...rule,
    range: {
      top: isRow ? moveStart(rule.range.top) : rule.range.top,
      bottom: isRow ? moveEnd(rule.range.bottom) : rule.range.bottom,
      left: isRow ? rule.range.left : moveStart(rule.range.left),
      right: isRow ? rule.range.right : moveEnd(rule.range.right),
    },
  })).filter((rule) => rule.range.bottom >= rule.range.top && rule.range.right >= rule.range.left);
}

/** Moves the filter view; the filter of a removed column disappears with its column. */
function applyToFilter(worksheet, isRow, moveIndex, moveStart, moveEnd) {
  const filter = worksheet.filter && typeof worksheet.filter === "object" ? worksheet.filter : null;
  if (!filter) {
    worksheet.filter = null;
    return;
  }
  const region = {
    top: isRow ? moveStart(filter.region.top) : filter.region.top,
    bottom: isRow ? moveEnd(filter.region.bottom) : filter.region.bottom,
    left: isRow ? filter.region.left : moveStart(filter.region.left),
    right: isRow ? filter.region.right : moveEnd(filter.region.right),
  };
  if (region.bottom < region.top || region.right < region.left) {
    worksheet.filter = null;
    return;
  }
  const columns = filter.columns.flatMap((entry) => {
    const column = isRow ? entry.column : moveIndex(entry.column);
    if (column === null || column < region.left || column > region.right) return [];
    return [{ ...entry, column }];
  });
  worksheet.filter = { region, columns };
}

/** Moves the stored selection; a removed row or column keeps the position the next one moved to. */
function applyToSelection(worksheet, change, rowCount, columnCount) {
  const { axis, op, index, side } = change;
  const stored = worksheet.selection;
  const move = (value) => {
    const moved = movedIndex(op, index, side, value);
    return moved === null ? index : moved;
  };
  const moveAddress = (address) => ({
    row: Math.min(Math.max(address?.row > 0 ? address.row : 1, 1), rowCount),
    column: Math.min(Math.max(address?.column > 0 ? address.column : 1, 1), columnCount),
  });
  if (!stored?.anchor || !stored?.focus) {
    worksheet.selection = { anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } };
    return;
  }
  const anchor = axis === ROW_AXIS
    ? { ...stored.anchor, row: move(stored.anchor.row) }
    : { ...stored.anchor, column: move(stored.anchor.column) };
  const focus = axis === ROW_AXIS
    ? { ...stored.focus, row: move(stored.focus.row) }
    : { ...stored.focus, column: move(stored.focus.column) };
  worksheet.selection = { anchor: moveAddress(anchor), focus: moveAddress(focus) };
}

/**
 * Moves the source range of every pivot table reading the changed worksheet, so a later
 * `Refresh pivot table` reads the shifted records (REQ-5-3-1). The stored summary is left as it is
 * until that refresh; the range keeps a usable shape (a deleted edge never crosses the other one),
 * so a range that lost every data row is refused when it is refreshed.
 */
export function applyPivotSourceShift(workbook, changedWorksheetId, change) {
  const worksheets = Array.isArray(workbook?.worksheets) ? workbook.worksheets : [];
  const isRow = change.axis === ROW_AXIS;
  const moveStart = (value) => movedStart(change.op, change.index, change.side, value);
  const moveEnd = (value) => movedEnd(change.op, change.index, change.side, value);
  for (const worksheet of worksheets) {
    const pivot = worksheet.pivot;
    if (!pivot || typeof pivot !== "object" || pivot.sourceWorksheetId !== changedWorksheetId) continue;
    const range = readRegion(pivot.sourceRange);
    if (!range) continue;
    const start = isRow ? moveStart(range.top) : moveStart(range.left);
    const end = Math.max(start, isRow ? moveEnd(range.bottom) : moveEnd(range.right));
    worksheet.pivot = {
      ...pivot,
      sourceRange: isRow
        ? { top: start, bottom: end, left: range.left, right: range.right }
        : { top: range.top, bottom: range.bottom, left: start, right: end },
    };
  }
}

/** Applies one checked structure change to a worksheet in place. */
export function applyStructureChange(worksheet, change) {
  const { axis, op, index, side } = change;
  const isRow = axis === ROW_AXIS;
  const moveIndex = (value) => movedIndex(op, index, side, value);
  const moveStart = (value) => movedStart(op, index, side, value);
  const moveEnd = (value) => movedEnd(op, index, side, value);
  const moveRow = isRow ? moveIndex : (value) => value;
  const moveColumn = isRow ? (value) => value : moveIndex;

  applyToCells(worksheet, moveRow, moveColumn);
  applyToValidations(worksheet, isRow, moveStart, moveEnd);
  applyToFilter(worksheet, isRow, moveIndex, moveStart, moveEnd);

  const rowCount = sheetRowCount(worksheet) + (axis === ROW_AXIS && op === INSERT ? 1 : 0);
  const columnCount = sheetColumnCount(worksheet) + (axis === COLUMN_AXIS && op === INSERT ? 1 : 0);
  worksheet.rowCount = rowCount;
  worksheet.columnCount = columnCount;
  applyToSelection(worksheet, change, rowCount, columnCount);
}

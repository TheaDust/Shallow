import {
  adjustFormulaText,
  columnDeleteShift,
  columnInsertShift,
  rowDeleteShift,
  rowInsertShift,
  shiftIndex,
} from "./formulas.mjs";
import { cellCoordinate, isCellCoordinate, parseCellCoordinate } from "./spreadsheet.mjs";

/**
 * Structural row/column operations on one worksheet. Every function mutates a single *normalized*
 * worksheet in place and keeps its dependent state aligned:
 *
 * - `cells` move together with their formulas, whose A1 references are rewritten
 *   (`#REF!` when a referenced row/column was deleted),
 * - `selection` follows the cell it was pointing at,
 * - `validations[].range`, `filters[].range` and `pivot.source.range` move with their targets,
 * - `rowCount`/`columnCount` only grow, so a shifted grid never drops existing content.
 *
 * Other worksheets of the workbook are never touched; a pivot source range stored on another
 * worksheet is shifted by `shiftPivotSources`, which keeps the previous pivot *result* intact until
 * the pivot is explicitly refreshed.
 */

function sortedCells(cells) {
  return Object.entries(cells)
    .map(([coordinate, value]) => ({ coordinate, value, position: parseCellCoordinate(coordinate) }))
    .filter((entry) => entry.position !== null)
    .sort((a, b) => a.position.row - b.position.row || a.position.column - b.position.column);
}

function remapCells(worksheet, rowShift, columnShift) {
  const shifts = [rowShift, columnShift].filter(Boolean);
  const next = {};
  for (const { coordinate, value, position } of sortedCells(worksheet.cells)) {
    const row = rowShift ? shiftIndex(position.row, rowShift) : position.row;
    const column = columnShift ? shiftIndex(position.column, columnShift) : position.column;
    if (row === null || column === null) continue;
    next[cellCoordinate(row, column)] = adjustFormulaText(value, shifts, { sheetName: worksheet.name });
  }
  worksheet.cells = next;
}

function shiftCoordinate(coordinate, rowShift, columnShift, { clampRow, clampColumn }) {
  if (!isCellCoordinate(coordinate)) return coordinate;
  const position = parseCellCoordinate(coordinate);
  let row = rowShift ? shiftIndex(position.row, rowShift) : position.row;
  let column = columnShift ? shiftIndex(position.column, columnShift) : position.column;
  if (row === null) row = Math.min(rowShift.index, clampRow);
  if (column === null) column = Math.min(columnShift.index, clampColumn);
  return cellCoordinate(row, column);
}

function shiftSelection(worksheet, rowShift, columnShift) {
  const selection = worksheet.selection;
  return {
    anchor: shiftCoordinate(selection.anchor, rowShift, columnShift, {
      clampRow: worksheet.rowCount - 1,
      clampColumn: worksheet.columnCount - 1,
    }),
    focus: shiftCoordinate(selection.focus, rowShift, columnShift, {
      clampRow: worksheet.rowCount - 1,
      clampColumn: worksheet.columnCount - 1,
    }),
  };
}

/** One endpoint (0-based) of a range record; see `formulas.mjs#shiftIndex`. */
function shiftRange(range, shift) {
  if (!range || !isCellCoordinate(range.start) || !isCellCoordinate(range.end)) return null;
  const start = parseCellCoordinate(range.start);
  const end = parseCellCoordinate(range.end);
  const first = shift.axis === "row" ? start.row : start.column;
  const last = shift.axis === "row" ? end.row : end.column;

  let nextFirst;
  let nextLast;
  if (shift.kind === "insert") {
    // An insert above the range moves it; an insert strictly inside the range extends it.
    if (first >= shift.index) {
      nextFirst = first + shift.count;
      nextLast = last + shift.count;
    } else if (last >= shift.index) {
      nextFirst = first;
      nextLast = last + shift.count;
    } else {
      nextFirst = first;
      nextLast = last;
    }
  } else {
    const removed = (value) => value - Math.max(0, Math.min(shift.count, value - shift.index));
    nextFirst = first < shift.index ? first : removed(first);
    nextLast = removed(last + 1) - 1;
    if (nextLast < nextFirst) return null;
  }

  const build = (row, column) => cellCoordinate(row, column);
  return shift.axis === "row"
    ? { start: build(nextFirst, start.column), end: build(nextLast, end.column) }
    : { start: build(start.row, nextFirst), end: build(end.row, nextLast) };
}

function shiftRangeRecords(records, shift) {
  if (!Array.isArray(records)) return records;
  const next = [];
  for (const record of records) {
    const range = shiftRange(record?.range, shift);
    if (range) next.push({ ...record, range });
  }
  return next;
}

/**
 * A pivot source range follows the structure change so a later refresh uses the moved fields. When
 * the whole source range disappears the last range is kept: the previous pivot result stays visible
 * and the pivot editor has to report the missing field.
 */
function shiftPivotRecord(pivot, shift) {
  const range = shiftRange(pivot.source?.range, shift);
  return range ? { ...pivot, source: { ...pivot.source, range } } : pivot;
}

function shiftDependentState(worksheet, shift) {
  if (Array.isArray(worksheet.validations)) {
    worksheet.validations = shiftRangeRecords(worksheet.validations, shift);
  }
  if (Array.isArray(worksheet.filters)) {
    worksheet.filters = shiftRangeRecords(worksheet.filters, shift);
  }
  if (worksheet.pivot) {
    worksheet.pivot = shiftPivotRecord(worksheet.pivot, shift);
  }
}

function usedRowCount(cells) {
  return Object.keys(cells).reduce((max, coordinate) => Math.max(max, parseCellCoordinate(coordinate).row + 1), 0);
}

function usedColumnCount(cells) {
  return Object.keys(cells).reduce((max, coordinate) => Math.max(max, parseCellCoordinate(coordinate).column + 1), 0);
}

export function insertRows(worksheet, { index, count = 1 } = {}) {
  const shift = rowInsertShift(index, count);
  remapCells(worksheet, shift, null);
  worksheet.selection = shiftSelection(worksheet, shift, null);
  shiftDependentState(worksheet, shift);
  worksheet.rowCount = Math.max(worksheet.rowCount, usedRowCount(worksheet.cells));
  return worksheet;
}

export function deleteRows(worksheet, { index, count = 1 } = {}) {
  const shift = rowDeleteShift(index, count);
  remapCells(worksheet, shift, null);
  worksheet.selection = shiftSelection(worksheet, shift, null);
  shiftDependentState(worksheet, shift);
  return worksheet;
}

export function insertColumns(worksheet, { index, count = 1 } = {}) {
  const shift = columnInsertShift(index, count);
  remapCells(worksheet, null, shift);
  worksheet.selection = shiftSelection(worksheet, null, shift);
  shiftDependentState(worksheet, shift);
  worksheet.columnCount = Math.max(worksheet.columnCount, usedColumnCount(worksheet.cells));
  return worksheet;
}

export function deleteColumns(worksheet, { index, count = 1 } = {}) {
  const shift = columnDeleteShift(index, count);
  remapCells(worksheet, null, shift);
  worksheet.selection = shiftSelection(worksheet, null, shift);
  shiftDependentState(worksheet, shift);
  return worksheet;
}

/**
 * Moves every pivot source range that points at `worksheetId` with the structure change. The pivot
 * result cells stay untouched, so the last successful result is still displayed until the pivot is
 * refreshed.
 */
export function shiftPivotSources(workbook, worksheetId, shift) {
  for (const worksheet of workbook.worksheets) {
    if (!worksheet.pivot || worksheet.pivot.source?.worksheetId !== worksheetId) continue;
    worksheet.pivot = shiftPivotRecord(worksheet.pivot, shift);
  }
}

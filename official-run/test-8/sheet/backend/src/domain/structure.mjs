import { cellCoordinate, parseCoordinate } from "./workbook-model.mjs";
import { normalizeFilter } from "./filter.mjs";
import { shiftFormula } from "./formula.mjs";

/** Upper bounds keep an inserted grid within a range the UI can still render. */
export const MAX_ROW_COUNT = 1000;
export const MAX_COLUMN_COUNT = 200;

/**
 * Row/column structure commands offered by the grid header menus. `offset`
 * turns the target index into an insertion point (`above`/`below`,
 * `left`/`right`); deletion ignores it.
 */
const OPERATIONS = {
  insertRowAbove: { axis: "row", mode: "insert", offset: 0 },
  insertRowBelow: { axis: "row", mode: "insert", offset: 1 },
  deleteRow: { axis: "row", mode: "delete", offset: 0 },
  insertColumnLeft: { axis: "column", mode: "insert", offset: 0 },
  insertColumnRight: { axis: "column", mode: "insert", offset: 1 },
  deleteColumn: { axis: "column", mode: "delete", offset: 0 },
};

export function isStructureOperation(operation) {
  return Object.prototype.hasOwnProperty.call(OPERATIONS, operation);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function remapCoordinate(coordinate, change, rowCount, columnCount) {
  let { row, col } = coordinate;
  if (change.axis === "row") {
    if (change.mode === "insert") {
      if (row >= change.index) row += 1;
    } else if (row > change.index) {
      row -= 1;
    }
  } else if (change.mode === "insert") {
    if (col >= change.index) col += 1;
  } else if (col > change.index) {
    col -= 1;
  }
  return {
    row: clamp(row, 0, rowCount - 1),
    col: clamp(col, 0, columnCount - 1),
  };
}

function mapRangeStart(value, change) {
  if (change.mode === "insert") return value >= change.index ? value + 1 : value;
  return value <= change.index ? value : value - 1;
}

function mapRangeEnd(value, change) {
  if (change.mode === "insert") return value >= change.index ? value + 1 : value;
  return value < change.index ? value : value - 1;
}

/**
 * Moves a validation rule's rectangle with the cells it constrains. A rule
 * whose whole range is removed (or is pushed outside the grid) is dropped.
 */
function remapValidations(validations, change, rowCount, columnCount) {
  if (!Array.isArray(validations) || validations.length === 0) return validations;
  const next = [];
  for (const rule of validations) {
    const range = rule?.range;
    if (!range) {
      next.push(rule);
      continue;
    }
    const minRow = change.axis === "row" ? mapRangeStart(range.minRow, change) : range.minRow;
    const maxRow = change.axis === "row" ? mapRangeEnd(range.maxRow, change) : range.maxRow;
    const minCol = change.axis === "column" ? mapRangeStart(range.minCol, change) : range.minCol;
    const maxCol = change.axis === "column" ? mapRangeEnd(range.maxCol, change) : range.maxCol;
    if (minRow > maxRow || minCol > maxCol) continue;
    if (minRow < 0 || minCol < 0 || maxRow >= rowCount || maxCol >= columnCount) continue;
    next.push({ ...rule, range: { minRow, maxRow, minCol, maxCol } });
  }
  return next;
}

function remapCells(cells, change) {
  const next = {};
  for (const [key, value] of Object.entries(cells)) {
    const coordinate = parseCoordinate(key);
    if (!coordinate) {
      next[key] = value;
      continue;
    }
    let { row, col } = coordinate;
    if (change.axis === "row") {
      if (change.mode === "insert") {
        if (row >= change.index) row += 1;
      } else {
        if (row === change.index) continue;
        if (row > change.index) row -= 1;
      }
    } else if (change.mode === "insert") {
      if (col >= change.index) col += 1;
    } else {
      if (col === change.index) continue;
      if (col > change.index) col -= 1;
    }
    next[cellCoordinate(row, col)] = typeof value === "string" ? shiftFormula(value, change) : value;
  }
  return next;
}

/**
 * Moves a filter with the region it covers. A column filter whose column is
 * deleted is dropped, as is a filter pushed outside the grid.
 */
function remapFilter(filter, change, rowCount, columnCount) {
  if (!filter || typeof filter !== "object" || !filter.range) return filter ?? null;
  const range = filter.range;
  const minRow = change.axis === "row" ? mapRangeStart(range.minRow, change) : range.minRow;
  const maxRow = change.axis === "row" ? mapRangeEnd(range.maxRow, change) : range.maxRow;
  const minCol = change.axis === "column" ? mapRangeStart(range.minCol, change) : range.minCol;
  const maxCol = change.axis === "column" ? mapRangeEnd(range.maxCol, change) : range.maxCol;
  if (minRow > maxRow || minCol > maxCol) return null;
  const columns = [];
  for (const column of Array.isArray(filter.columns) ? filter.columns : []) {
    if (!Number.isInteger(column?.col)) continue;
    let col = column.col;
    if (change.axis === "column") {
      if (change.mode === "delete") {
        if (col === change.index) continue;
        if (col > change.index) col -= 1;
      } else if (col >= change.index) {
        col += 1;
      }
    }
    columns.push({ ...column, col });
  }
  return normalizeFilter({ range: { minRow, maxRow, minCol, maxCol }, columns }, rowCount, columnCount);
}

/**
 * Applies one row/column structure operation to a worksheet, returning a new
 * worksheet (`{ok: true, worksheet}`) or a validation failure
 * (`{ok: false, error}`). Cell content, formula references and the selection
 * move together; the original worksheet is never mutated.
 */
export function applyStructureOperation(worksheet, operation, index) {
  const spec = OPERATIONS[operation];
  if (!spec) return { ok: false, error: "Unknown structure operation" };

  const count = spec.axis === "row" ? worksheet.rowCount : worksheet.columnCount;
  const max = spec.axis === "row" ? MAX_ROW_COUNT : MAX_COLUMN_COUNT;
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    return { ok: false, error: spec.axis === "row" ? "Row index out of range" : "Column index out of range" };
  }
  if (spec.mode === "delete" && count <= 1) {
    return {
      ok: false,
      error: spec.axis === "row" ? "Cannot delete the only row" : "Cannot delete the only column",
    };
  }
  if (spec.mode === "insert" && count >= max) {
    return {
      ok: false,
      error: spec.axis === "row" ? "Cannot insert more rows" : "Cannot insert more columns",
    };
  }

  const change = { axis: spec.axis, mode: spec.mode, index: index + spec.offset };
  const delta = spec.mode === "insert" ? 1 : -1;
  const rowCount = spec.axis === "row" ? count + delta : worksheet.rowCount;
  const columnCount = spec.axis === "column" ? count + delta : worksheet.columnCount;

  const selection = {
    anchor: remapCoordinate(worksheet.selection.anchor, change, rowCount, columnCount),
    focus: remapCoordinate(worksheet.selection.focus, change, rowCount, columnCount),
  };

  return {
    ok: true,
    worksheet: {
      ...worksheet,
      rowCount,
      columnCount,
      cells: remapCells(worksheet.cells, change),
      selection,
      validations: remapValidations(worksheet.validations, change, rowCount, columnCount),
      filter: remapFilter(worksheet.filter, change, rowCount, columnCount),
    },
  };
}

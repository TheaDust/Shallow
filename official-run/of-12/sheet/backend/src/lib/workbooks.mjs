import { randomUUID } from "node:crypto";

import { columnDeleteShift, columnInsertShift, rowDeleteShift, rowInsertShift } from "./formulas.mjs";
import { parsePastedText, pastedRectangle, pastedRectangleBounds } from "./paste.mjs";
import { allowedValues, numberRangeMessage, validationRejection } from "./validation.mjs";
import { applyRangeTransfer, planRangeTransfer, RANGE_TRANSFER_MODES } from "./range-transfer.mjs";
import { planRangeSort, SORT_ORDERS } from "./sort-range.mjs";
import {
  computePivotCells,
  defaultPivotSettings,
  nextPivotWorksheetName,
  normalizePivotSettings,
  PivotError,
} from "./pivot.mjs";
import {
  cellCoordinate,
  columnIndex,
  DEFAULT_COLUMN_COUNT,
  DEFAULT_ROW_COUNT,
  isCellCoordinate,
  parseCellCoordinate,
} from "./spreadsheet.mjs";
import {
  deleteColumns,
  deleteRows,
  insertColumns,
  insertRows,
  shiftPivotSources,
} from "./structure.mjs";

export class DomainError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "DomainError";
    this.status = status;
  }
}

export const EMPTY_WORKBOOK_NAME_MESSAGE = "Workbook name cannot be empty";
export const WORKBOOK_NOT_FOUND_MESSAGE = "Workbook not found";
export const WORKSHEET_NOT_FOUND_MESSAGE = "Worksheet not found";
export const INVALID_WORKBOOK_NAME_MESSAGE = "Workbook name is invalid";
export const INVALID_ROW_MESSAGE = "Invalid row number";
export const INVALID_COLUMN_MESSAGE = "Invalid column";
export const UNSUPPORTED_STRUCTURE_MESSAGE = "Unsupported structure operation";
export const INVALID_CELL_MESSAGE = "Invalid cell coordinate";
export const NOTHING_TO_PASTE_MESSAGE = "Nothing to paste";
export const INVALID_RANGE_MESSAGE = "Invalid range";
export const UNSUPPORTED_TRANSFER_MESSAGE = "Unsupported range operation";
export const FILTER_NOT_FOUND_MESSAGE = "Filter not found";
export const INVALID_FILTER_MESSAGE = "Invalid filter condition";
export const INVALID_SORT_COLUMN_MESSAGE = "Invalid sort column";
export const UNSUPPORTED_SORT_ORDER_MESSAGE = "Unsupported sort order";
export const RULE_NOT_FOUND_MESSAGE = "Validation rule not found";
export const EMPTY_WORKSHEET_NAME_MESSAGE = "Worksheet name cannot be empty";
export const DUPLICATE_WORKSHEET_NAME_MESSAGE = "Worksheet name already exists";
export const LAST_WORKSHEET_MESSAGE = "A workbook must contain at least one worksheet";
export const PIVOT_SOURCE_DEPENDENCY_MESSAGE = "Please delete or rebuild dependent pivot tables first";
export const PIVOT_NOT_FOUND_MESSAGE = "Pivot table not found";
export const INVALID_RULE_MESSAGE = "Invalid validation rule";
export const EMPTY_ALLOWED_VALUES_MESSAGE = "Allowed values cannot be empty";
export const INVALID_NUMBER_RANGE_MESSAGE = "Enter a valid number range";

/** Column-filter operators of REQ-5-1-2, in the order the dialog lists them. */
export const FILTER_OPERATORS = ["text-contains", "greater-than", "before", "is-empty", "is-not-empty"];
export const DROPDOWN_RULE = "dropdown";
export const NUMBER_RANGE_RULE = "number-range";

export const ROW_ACTIONS = ["insert-above", "insert-below", "delete"];
export const COLUMN_ACTIONS = ["insert-left", "insert-right", "delete"];

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSelection(selection) {
  const anchor = isCellCoordinate(selection?.anchor) ? selection.anchor : "A1";
  const focus = isCellCoordinate(selection?.focus) ? selection.focus : anchor;
  return { anchor, focus };
}

function normalizeRange(range) {
  if (!isPlainObject(range)) return null;
  return isCellCoordinate(range.start) && isCellCoordinate(range.end)
    ? { start: range.start, end: range.end }
    : null;
}

/**
 * Region-bearing records (validation rules, filter views). The row/column structure operations
 * only interpret `range`; every other field belongs to the feature that owns the record and is
 * preserved verbatim.
 */
function normalizeRegionRecords(records, prefix) {
  if (!Array.isArray(records)) return [];
  const normalized = [];
  records.forEach((record, index) => {
    const range = normalizeRange(record?.range);
    if (!range) return;
    const rest = isPlainObject(record) ? { ...record } : {};
    delete rest.id;
    delete rest.range;
    normalized.push({
      ...structuredClone(rest),
      id: typeof record?.id === "string" && record.id ? record.id : `${prefix}-${index + 1}`,
      range,
    });
  });
  return normalized;
}

/**
 * Pivot configuration lives on the pivot worksheet (the worksheet whose cells show the result),
 * and only its source range follows a structure edit. The fields are stored as header texts of the
 * source range, so a moved column keeps its field.
 */
function normalizePivot(pivot) {
  const range = normalizeRange(pivot?.source?.range);
  const worksheetId = pivot?.source?.worksheetId;
  if (!range || typeof worksheetId !== "string" || !worksheetId) return null;
  return {
    source: { worksheetId, range },
    ...normalizePivotSettings(pivot),
  };
}

export function normalizeWorksheet(worksheet, index) {
  const cells = {};
  if (isPlainObject(worksheet?.cells)) {
    for (const [coordinate, value] of Object.entries(worksheet.cells)) {
      if (isCellCoordinate(coordinate) && value !== "" && value !== null && value !== undefined) {
        cells[coordinate] = String(value);
      }
    }
  }
  const rowCount = Number.isInteger(worksheet?.rowCount) && worksheet.rowCount > 0
    ? worksheet.rowCount
    : DEFAULT_ROW_COUNT;
  const columnCount = Number.isInteger(worksheet?.columnCount) && worksheet.columnCount > 0
    ? worksheet.columnCount
    : DEFAULT_COLUMN_COUNT;
  return {
    id: typeof worksheet?.id === "string" && worksheet.id ? worksheet.id : `ws-${randomUUID()}`,
    name: typeof worksheet?.name === "string" && worksheet.name ? worksheet.name : `Sheet${index + 1}`,
    rowCount,
    columnCount,
    cells,
    selection: normalizeSelection(worksheet?.selection),
    validations: normalizeRegionRecords(worksheet?.validations, "dv"),
    filters: normalizeRegionRecords(worksheet?.filters, "filter"),
    pivot: normalizePivot(worksheet?.pivot),
  };
}

export function normalizeWorkbook(workbook) {
  const worksheets = Array.isArray(workbook?.worksheets) && workbook.worksheets.length
    ? workbook.worksheets.map(normalizeWorksheet)
    : [normalizeWorksheet({}, 0)];
  const activeWorksheetId = worksheets.some((sheet) => sheet.id === workbook?.activeWorksheetId)
    ? workbook.activeWorksheetId
    : worksheets[0].id;
  const updatedAt = typeof workbook?.updatedAt === "string" ? workbook.updatedAt : new Date().toISOString();
  return {
    id: String(workbook?.id ?? `wb-${randomUUID()}`),
    name: typeof workbook?.name === "string" && workbook.name ? workbook.name : "Untitled workbook",
    createdAt: typeof workbook?.createdAt === "string" ? workbook.createdAt : updatedAt,
    updatedAt,
    activeWorksheetId,
    worksheets,
  };
}

export function normalizeState(state) {
  const workbooks = Array.isArray(state?.workbooks) ? state.workbooks.map(normalizeWorkbook) : [];
  return { workbooks };
}

export function normalizeWorkbookName(name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) throw new DomainError(EMPTY_WORKBOOK_NAME_MESSAGE);
  if (trimmed.length > 200) throw new DomainError(INVALID_WORKBOOK_NAME_MESSAGE);
  return trimmed;
}

export function listWorkbooks(state) {
  return state.workbooks.map((workbook) => ({
    id: workbook.id,
    name: workbook.name,
    updatedAt: workbook.updatedAt,
    worksheetCount: workbook.worksheets.length,
    activeWorksheetName: workbook.worksheets.find((sheet) => sheet.id === workbook.activeWorksheetId)?.name ?? null,
  }));
}

export function findWorkbook(state, workbookId) {
  return state.workbooks.find((workbook) => workbook.id === workbookId) ?? null;
}

export function requireWorkbook(state, workbookId) {
  const workbook = findWorkbook(state, workbookId);
  if (!workbook) throw new DomainError(WORKBOOK_NOT_FOUND_MESSAGE, 404);
  return workbook;
}

/** Strict worksheet lookup used by operations that must never touch another worksheet. */
export function requireWorksheetById(workbook, worksheetId) {
  const worksheet = workbook.worksheets.find((sheet) => sheet.id === worksheetId);
  if (!worksheet) throw new DomainError(WORKSHEET_NOT_FOUND_MESSAGE, 404);
  return worksheet;
}

export function requireWorksheet(workbook, worksheetId) {
  const worksheet = workbook.worksheets.find((sheet) => sheet.id === worksheetId)
    ?? workbook.worksheets.find((sheet) => sheet.id === workbook.activeWorksheetId)
    ?? workbook.worksheets[0];
  if (!worksheet) throw new DomainError(WORKSHEET_NOT_FOUND_MESSAGE, 404);
  return worksheet;
}

export function createBlankWorkbook(state, { name, now = new Date().toISOString() } = {}) {
  const workbook = {
    id: `wb-${randomUUID()}`,
    name: normalizeWorkbookName(name),
    createdAt: now,
    updatedAt: now,
    activeWorksheetId: null,
    worksheets: [{ ...normalizeWorksheet({ name: "Sheet1" }, 0) }],
  };
  workbook.activeWorksheetId = workbook.worksheets[0].id;
  state.workbooks.push(workbook);
  return workbook;
}

/**
 * Creates a workbook for an imported CSV table. `rows` holds raw field text in the original row
 * and column order; empty fields stay empty and the first row is ordinary data (no header).
 */
export function createImportedWorkbook(state, { name, rows = [], now = new Date().toISOString() } = {}) {
  const worksheet = normalizeWorksheet({ name: "Sheet1" }, 0);
  let maxRow = -1;
  let maxColumn = -1;
  rows.forEach((row, rowIndex) => {
    if (!Array.isArray(row)) return;
    row.forEach((value, columnIndex) => {
      const text = value === null || value === undefined ? "" : String(value);
      if (text === "") return;
      worksheet.cells[cellCoordinate(rowIndex, columnIndex)] = text;
      if (rowIndex > maxRow) maxRow = rowIndex;
      if (columnIndex > maxColumn) maxColumn = columnIndex;
    });
  });
  worksheet.rowCount = Math.max(DEFAULT_ROW_COUNT, maxRow + 1);
  worksheet.columnCount = Math.max(DEFAULT_COLUMN_COUNT, maxColumn + 1);

  const workbook = {
    id: `wb-${randomUUID()}`,
    name: normalizeWorkbookName(name),
    createdAt: now,
    updatedAt: now,
    activeWorksheetId: worksheet.id,
    worksheets: [worksheet],
  };
  state.workbooks.push(workbook);
  return workbook;
}

export function renameWorkbook(state, workbookId, { name, now = new Date().toISOString() } = {}) {
  const workbook = requireWorkbook(state, workbookId);
  workbook.name = normalizeWorkbookName(name);
  workbook.updatedAt = now;
  return workbook;
}

/** First unused `SheetN` name in positive-integer order (`Sheet1`+`Sheet2` → `Sheet3`). */
export function nextWorksheetName(workbook) {
  const used = new Set();
  for (const worksheet of workbook.worksheets) {
    const match = /^Sheet([1-9][0-9]*)$/.exec(worksheet.name);
    if (match) used.add(Number(match[1]));
  }
  let index = 1;
  while (used.has(index)) index += 1;
  return `Sheet${index}`;
}

/**
 * `Add worksheet`: appends a blank worksheet to the tab order and makes it the active one with A1
 * selected. The new sheet starts without the filters, validation rules or pivot results of any
 * other worksheet, so the existing worksheets keep their grid and state untouched.
 */
export function addWorksheet(state, workbookId, { now = new Date().toISOString() } = {}) {
  const workbook = requireWorkbook(state, workbookId);
  const worksheet = normalizeWorksheet({ name: nextWorksheetName(workbook) }, workbook.worksheets.length);
  workbook.worksheets.push(worksheet);
  workbook.activeWorksheetId = worksheet.id;
  workbook.updatedAt = now;
  return workbook;
}

/**
 * `Rename`: the name is trimmed and must be non-empty and unused inside this workbook (a worksheet
 * may keep its own name). A rejected rename leaves the previous name on the tab.
 */
export function renameWorksheet(state, workbookId, worksheetId, { name, now = new Date().toISOString() } = {}) {
  const workbook = requireWorkbook(state, workbookId);
  const worksheet = requireWorksheetById(workbook, worksheetId);
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) throw new DomainError(EMPTY_WORKSHEET_NAME_MESSAGE);
  if (workbook.worksheets.some((sheet) => sheet.id !== worksheet.id && sheet.name === trimmed)) {
    throw new DomainError(DUPLICATE_WORKSHEET_NAME_MESSAGE);
  }
  worksheet.name = trimmed;
  workbook.updatedAt = now;
  return workbook;
}

/**
 * `Delete`: removes one worksheet together with everything it owns (grid values, formulas,
 * validation rules, filters and a pivot result) and leaves every other worksheet unchanged. A
 * workbook always keeps at least one worksheet, and a worksheet a pivot result still reads is
 * refused. The neighbor tab of the deleted worksheet becomes active.
 */
export function deleteWorksheet(state, workbookId, worksheetId, { now = new Date().toISOString() } = {}) {
  const workbook = requireWorkbook(state, workbookId);
  const worksheet = requireWorksheetById(workbook, worksheetId);
  if (workbook.worksheets.length <= 1) throw new DomainError(LAST_WORKSHEET_MESSAGE);
  const dependent = workbook.worksheets.some(
    (sheet) => sheet.id !== worksheet.id && sheet.pivot?.source?.worksheetId === worksheet.id,
  );
  if (dependent) throw new DomainError(PIVOT_SOURCE_DEPENDENCY_MESSAGE);

  const index = workbook.worksheets.findIndex((sheet) => sheet.id === worksheet.id);
  workbook.worksheets.splice(index, 1);
  const neighbor = workbook.worksheets[index - 1] ?? workbook.worksheets[index];
  workbook.activeWorksheetId = neighbor.id;
  workbook.updatedAt = now;
  return workbook;
}

function ensureCellWithinBounds(worksheet, coordinate) {
  const position = parseCellCoordinate(coordinate);
  if (!position) throw new DomainError("Invalid cell coordinate");
  if (position.row + 1 > worksheet.rowCount) worksheet.rowCount = position.row + 1;
  if (position.column + 1 > worksheet.columnCount) worksheet.columnCount = position.column + 1;
  return coordinate;
}

export function setCellValue(state, workbookId, { worksheetId, cell, value, now = new Date().toISOString() } = {}) {
  const workbook = requireWorkbook(state, workbookId);
  const worksheet = requireWorksheet(workbook, worksheetId);
  if (!isCellCoordinate(cell)) throw new DomainError(INVALID_CELL_MESSAGE);
  const coordinate = ensureCellWithinBounds(worksheet, cell);
  const text = value === null || value === undefined ? "" : String(value);
  const rejection = validationRejection(worksheet.validations, [{ coordinate, value: text }]);
  if (rejection) throw new DomainError(rejection);
  if (value === null || value === undefined || value === "") delete worksheet.cells[coordinate];
  else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    worksheet.cells[coordinate] = String(value);
  } else throw new DomainError("Invalid cell value");
  workbook.updatedAt = now;
  return workbook;
}

/**
 * Writes a whole pasted rectangle starting at `start`: tab-separated columns, newline-separated
 * rows, empty fields clearing their target cell. Every cell is written in one state update, so a
 * rejected paste (invalid coordinate, no data, or a numeric-range validation rule) leaves the
 * worksheet on its last successful state. Cells outside the rectangle are never touched, and the
 * strict worksheet lookup keeps a paste from landing on any other worksheet.
 */
export function pasteCells(state, workbookId, { worksheetId, start, text, now = new Date().toISOString() } = {}) {
  const workbook = requireWorkbook(state, workbookId);
  const worksheet = requireWorksheetById(workbook, worksheetId);
  if (!isCellCoordinate(start)) throw new DomainError(INVALID_CELL_MESSAGE);
  const rows = parsePastedText(text);
  const bounds = pastedRectangleBounds(rows, start);
  if (!bounds) throw new DomainError(NOTHING_TO_PASTE_MESSAGE);

  const updates = pastedRectangle(rows, start);
  const rejection = validationRejection(worksheet.validations, updates);
  if (rejection) throw new DomainError(rejection);

  for (const update of updates) {
    if (update.value === "") delete worksheet.cells[update.coordinate];
    else worksheet.cells[update.coordinate] = update.value;
  }
  worksheet.rowCount = Math.max(worksheet.rowCount, bounds.rows);
  worksheet.columnCount = Math.max(worksheet.columnCount, bounds.columns);
  workbook.updatedAt = now;
  return workbook;
}

/**
 * Copies or cuts one rectangular range onto a target location of the same worksheet. The whole
 * operation is planned before anything is written and applied in one state update: either the
 * target rectangle (plus the cleared cut source) is written completely, or - when a numeric-range
 * validation rule refuses a target value or the request is malformed - nothing changes at all.
 */
export function transferWorksheetRange(state, workbookId, { worksheetId, source, target, mode, now = new Date().toISOString() } = {}) {
  const workbook = requireWorkbook(state, workbookId);
  const worksheet = requireWorksheetById(workbook, worksheetId);
  if (!RANGE_TRANSFER_MODES.includes(mode)) throw new DomainError(UNSUPPORTED_TRANSFER_MESSAGE);
  const plan = planRangeTransfer(worksheet, { source, target, mode });
  if (!plan) throw new DomainError(INVALID_RANGE_MESSAGE);
  const rejection = validationRejection(worksheet.validations, plan.writes);
  if (rejection) throw new DomainError(rejection);

  applyRangeTransfer(worksheet, plan);
  workbook.updatedAt = now;
  return workbook;
}

function normalizeRowIndex(worksheet, row) {
  if (!Number.isInteger(row) || row < 1 || row > worksheet.rowCount) throw new DomainError(INVALID_ROW_MESSAGE);
  return row - 1;
}

function normalizeColumnIndex(worksheet, column) {
  const index = typeof column === "string" && /^[A-Z]+$/.test(column) ? columnIndex(column) : -1;
  if (index < 0 || index >= worksheet.columnCount) throw new DomainError(INVALID_COLUMN_MESSAGE);
  return index;
}

/**
 * Inserts or deletes one row of the active worksheet. The whole worksheet is re-mapped before the
 * state is written, so a rejected request leaves the stored structure untouched.
 */
export function changeWorksheetRows(state, workbookId, worksheetId, { action, row, now = new Date().toISOString() } = {}) {
  const workbook = requireWorkbook(state, workbookId);
  const worksheet = requireWorksheetById(workbook, worksheetId);
  if (!ROW_ACTIONS.includes(action)) throw new DomainError(UNSUPPORTED_STRUCTURE_MESSAGE);
  const index = normalizeRowIndex(worksheet, row);

  if (action === "delete") {
    deleteRows(worksheet, { index });
    shiftPivotSources(workbook, worksheet.id, rowDeleteShift(index));
  } else {
    const target = action === "insert-above" ? index : index + 1;
    insertRows(worksheet, { index: target });
    shiftPivotSources(workbook, worksheet.id, rowInsertShift(target));
  }
  workbook.updatedAt = now;
  return workbook;
}

export function changeWorksheetColumns(state, workbookId, worksheetId, { action, column, now = new Date().toISOString() } = {}) {
  const workbook = requireWorkbook(state, workbookId);
  const worksheet = requireWorksheetById(workbook, worksheetId);
  if (!COLUMN_ACTIONS.includes(action)) throw new DomainError(UNSUPPORTED_STRUCTURE_MESSAGE);
  const index = normalizeColumnIndex(worksheet, column);

  if (action === "delete") {
    deleteColumns(worksheet, { index });
    shiftPivotSources(workbook, worksheet.id, columnDeleteShift(index));
  } else {
    const target = action === "insert-left" ? index : index + 1;
    insertColumns(worksheet, { index: target });
    shiftPivotSources(workbook, worksheet.id, columnInsertShift(target));
  }
  workbook.updatedAt = now;
  return workbook;
}

/**
 * Sorts one rectangular range of one worksheet by one of its columns (REQ-5-1-1). The whole range
 * is re-ordered in one state update: the records move together by row, a refusal writes nothing,
 * and cells outside the selected range keep their coordinate and value.
 */
export function sortWorksheetRange(state, workbookId, { worksheetId, range, column, order, hasHeaderRow, now = new Date().toISOString() } = {}) {
  const workbook = requireWorkbook(state, workbookId);
  const worksheet = requireWorksheetById(workbook, worksheetId);
  const normalized = normalizeRange(range);
  if (!normalized) throw new DomainError(INVALID_RANGE_MESSAGE);
  if (!SORT_ORDERS.includes(order)) throw new DomainError(UNSUPPORTED_SORT_ORDER_MESSAGE);
  const label = typeof column === "string" ? column.toUpperCase() : "";
  const sorted = planRangeSort(worksheet.cells, {
    range: normalized,
    column: label,
    order,
    hasHeaderRow: hasHeaderRow === true,
  });
  if (!sorted) throw new DomainError(INVALID_SORT_COLUMN_MESSAGE);
  worksheet.cells = sorted;
  workbook.updatedAt = now;
  return workbook;
}

/** Source worksheet a pivot record reads; an unknown one is a client error, never a crash. */
function requirePivotSource(workbook, pivot) {
  const source = workbook.worksheets.find((sheet) => sheet.id === pivot.source.worksheetId);
  if (!source) throw new DomainError(WORKSHEET_NOT_FOUND_MESSAGE, 404);
  return source;
}

/**
 * Computes one pivot result over its source worksheet. The pure computation refuses incomplete or
 * vanished fields and a value field without numbers; nothing is written before it succeeded, so a
 * refused request always keeps the last successful result and the stored configuration.
 */
function computePivotResult(workbook, pivot, settings) {
  const source = requirePivotSource(workbook, pivot);
  try {
    return computePivotCells(source.cells, pivot.source.range, settings);
  } catch (error) {
    if (error instanceof PivotError) throw new DomainError(error.message);
    throw error;
  }
}

/** Keeps the grid big enough for a result rectangle that outgrew the default grid. */
function growWorksheet(worksheet, cells) {
  for (const coordinate of Object.keys(cells)) {
    const position = parseCellCoordinate(coordinate);
    if (!position) continue;
    worksheet.rowCount = Math.max(worksheet.rowCount, position.row + 1);
    worksheet.columnCount = Math.max(worksheet.columnCount, position.column + 1);
  }
}

/**
 * `Create pivot table`: a new worksheet named with the first unused `PivotN` holds the result. Its
 * default configuration is applied right away, the source worksheet keeps every value and the new
 * worksheet becomes the active one.
 */
export function createPivotWorksheet(state, workbookId, { worksheetId, range, now = new Date().toISOString() } = {}) {
  const workbook = requireWorkbook(state, workbookId);
  const source = requireWorksheetById(workbook, worksheetId);
  const normalized = normalizeRange(range);
  if (!normalized) throw new DomainError(INVALID_RANGE_MESSAGE);
  const pivot = { source: { worksheetId: source.id, range: normalized } };
  let settings;
  try {
    settings = defaultPivotSettings(source.cells, normalized);
  } catch (error) {
    if (error instanceof PivotError) throw new DomainError(error.message);
    throw error;
  }
  const cells = computePivotResult(workbook, pivot, settings);

  const worksheet = normalizeWorksheet({ name: nextPivotWorksheetName(workbook.worksheets) }, workbook.worksheets.length);
  worksheet.pivot = { ...pivot, ...settings };
  worksheet.cells = cells;
  growWorksheet(worksheet, cells);
  workbook.worksheets.push(worksheet);
  workbook.activeWorksheetId = worksheet.id;
  workbook.updatedAt = now;
  return workbook;
}

/**
 * `Apply` of the pivot editor: the whole result is replaced by a fresh computation of the chosen
 * configuration over the current source range. A refused configuration writes nothing.
 */
export function applyPivotSettings(state, workbookId, worksheetId, settings = {}, { now = new Date().toISOString() } = {}) {
  const workbook = requireWorkbook(state, workbookId);
  const worksheet = requireWorksheetById(workbook, worksheetId);
  if (!worksheet.pivot) throw new DomainError(PIVOT_NOT_FOUND_MESSAGE, 404);
  const next = normalizePivotSettings({
    rows: "rows" in settings ? settings.rows : worksheet.pivot.rows,
    columns: "columns" in settings ? settings.columns : worksheet.pivot.columns,
    values: "values" in settings ? settings.values : worksheet.pivot.values,
    summarizeBy: "summarizeBy" in settings ? settings.summarizeBy : worksheet.pivot.summarizeBy,
  });
  const cells = computePivotResult(workbook, worksheet.pivot, next);
  worksheet.pivot = { ...worksheet.pivot, ...next };
  worksheet.cells = cells;
  growWorksheet(worksheet, cells);
  workbook.updatedAt = now;
  return workbook;
}

/**
 * `Refresh pivot table`: recomputes the stored configuration over the current source range, so a
 * moved or changed source produces a completely new summary. An unusable field or a value field
 * without numbers keeps the previous result and the source worksheet untouched.
 */
export function refreshPivot(state, workbookId, worksheetId, { now = new Date().toISOString() } = {}) {
  const workbook = requireWorkbook(state, workbookId);
  const worksheet = requireWorksheetById(workbook, worksheetId);
  if (!worksheet.pivot) throw new DomainError(PIVOT_NOT_FOUND_MESSAGE, 404);
  const cells = computePivotResult(workbook, worksheet.pivot, worksheet.pivot);
  worksheet.cells = cells;
  growWorksheet(worksheet, cells);
  workbook.updatedAt = now;
  return workbook;
}

export function setActiveWorksheet(state, workbookId, { worksheetId } = {}) {
  const workbook = requireWorkbook(state, workbookId);
  const worksheet = workbook.worksheets.find((sheet) => sheet.id === worksheetId);
  if (!worksheet) throw new DomainError(WORKSHEET_NOT_FOUND_MESSAGE, 404);
  workbook.activeWorksheetId = worksheet.id;
  return workbook;
}

export function setSelection(state, workbookId, worksheetId, { anchor, focus } = {}) {
  const workbook = requireWorkbook(state, workbookId);
  // The selection belongs to exactly one worksheet: never fall back to the active one.
  const worksheet = requireWorksheetById(workbook, worksheetId);
  if (!isCellCoordinate(anchor) || (focus !== undefined && !isCellCoordinate(focus))) {
    throw new DomainError(INVALID_CELL_MESSAGE);
  }
  worksheet.selection = { anchor, focus: focus ?? anchor };
  return worksheet;
}

/**
 * Creates the filter view of one worksheet (REQ-5-1-2) over the given region. A worksheet holds a
 * single active filter view, so creating one replaces the previous view; the filter records only
 * which rows are hidden, they never rewrite a cell.
 */
export function createFilter(state, workbookId, worksheetId, { range, now = new Date().toISOString() } = {}) {
  const workbook = requireWorkbook(state, workbookId);
  const worksheet = requireWorksheetById(workbook, worksheetId);
  const normalized = normalizeRange(range);
  if (!normalized) throw new DomainError(INVALID_RANGE_MESSAGE);
  worksheet.filters = [{ id: `filter-${randomUUID()}`, range: normalized, conditions: [] }];
  workbook.updatedAt = now;
  return workbook;
}

/** `Clear filter`: every source record of the worksheet becomes visible again, unchanged. */
export function clearFilters(state, workbookId, worksheetId, { now = new Date().toISOString() } = {}) {
  const workbook = requireWorkbook(state, workbookId);
  const worksheet = requireWorksheetById(workbook, worksheetId);
  worksheet.filters = [];
  workbook.updatedAt = now;
  return workbook;
}

function normalizeColumnCondition(column, condition) {
  if (condition === null || condition === undefined) return null;
  if (condition.kind === "values") {
    return { column, kind: "values", values: allowedValues(condition.values) };
  }
  if (condition.kind === "condition") {
    if (!FILTER_OPERATORS.includes(condition.operator)) throw new DomainError(INVALID_FILTER_MESSAGE);
    return {
      column,
      kind: "condition",
      operator: condition.operator,
      value: condition.value === null || condition.value === undefined ? "" : String(condition.value),
    };
  }
  throw new DomainError(INVALID_FILTER_MESSAGE);
}

/** Sets (or, with a `null` condition, clears) the filter of one column of the worksheet's view. */
export function setColumnFilter(state, workbookId, worksheetId, { filterId, column, condition, now = new Date().toISOString() } = {}) {
  const workbook = requireWorkbook(state, workbookId);
  const worksheet = requireWorksheetById(workbook, worksheetId);
  const filter = filterId
    ? worksheet.filters.find((record) => record.id === filterId)
    : worksheet.filters[0];
  if (!filter) throw new DomainError(FILTER_NOT_FOUND_MESSAGE, 404);
  const label = typeof column === "string" ? column.toUpperCase() : "";
  if (!/^[A-Z]+$/.test(label)) throw new DomainError(INVALID_COLUMN_MESSAGE);
  const others = filter.conditions.filter((record) => record.column !== label);
  const next = normalizeColumnCondition(label, condition);
  filter.conditions = next ? [...others, next] : others;
  workbook.updatedAt = now;
  return workbook;
}

function buildValidationRecord({ type, range, values, min, max }) {
  if (type === DROPDOWN_RULE) {
    const allowed = allowedValues(values);
    if (!allowed.length) throw new DomainError(EMPTY_ALLOWED_VALUES_MESSAGE);
    return { id: `dv-${randomUUID()}`, type: DROPDOWN_RULE, range, values: allowed };
  }
  if (type === NUMBER_RANGE_RULE) {
    const lower = typeof min === "number" ? min : Number(String(min ?? "").trim());
    const upper = typeof max === "number" ? max : Number(String(max ?? "").trim());
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper) {
      throw new DomainError(INVALID_NUMBER_RANGE_MESSAGE);
    }
    return {
      id: `dv-${randomUUID()}`,
      type: NUMBER_RANGE_RULE,
      range,
      min: lower,
      max: upper,
      message: numberRangeMessage(lower, upper),
    };
  }
  throw new DomainError(INVALID_RULE_MESSAGE);
}

/**
 * Creates a validation rule for a range, or updates the rule named by `ruleId` (a modification made
 * effective immediately on the range the user selected). Existing cell values are never rewritten,
 * so a rule can be added or removed without changing the data it covers.
 */
export function saveValidation(state, workbookId, worksheetId, { ruleId, type, range, values, min, max, now = new Date().toISOString() } = {}) {
  const workbook = requireWorkbook(state, workbookId);
  const worksheet = requireWorksheetById(workbook, worksheetId);
  const normalized = normalizeRange(range);
  if (!normalized) throw new DomainError(INVALID_RANGE_MESSAGE);
  const record = buildValidationRecord({ type, range: normalized, values, min, max });
  const index = ruleId ? worksheet.validations.findIndex((item) => item.id === ruleId) : -1;
  if (index >= 0) worksheet.validations[index] = { ...record, id: worksheet.validations[index].id };
  else worksheet.validations.push(record);
  workbook.updatedAt = now;
  return workbook;
}

/** `Delete rule`: removes the constraint; the values it covered stay as they are. */
export function deleteValidation(state, workbookId, worksheetId, { ruleId, now = new Date().toISOString() } = {}) {
  const workbook = requireWorkbook(state, workbookId);
  const worksheet = requireWorksheetById(workbook, worksheetId);
  const index = worksheet.validations.findIndex((item) => item.id === ruleId);
  if (index < 0) throw new DomainError(RULE_NOT_FOUND_MESSAGE, 404);
  worksheet.validations.splice(index, 1);
  workbook.updatedAt = now;
  return workbook;
}

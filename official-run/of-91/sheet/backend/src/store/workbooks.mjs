import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { createJsonStore } from "../lib/json-store.mjs";
import { NotFoundError, ValidationError } from "../lib/errors.mjs";
import { cellName, cellsFromRows, parseArea, parseCellName } from "../domain/grid.mjs";
import {
  STRUCTURE_AXES,
  STRUCTURE_MODES,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  shiftFilter,
  shiftPivot,
  shiftRuleRanges,
} from "../domain/structure.mjs";
import { FILTER_CONDITIONS } from "../domain/filter.mjs";
import { SORT_ORDERS, sortRangeCells } from "../domain/sort.mjs";
import { DROPDOWN_TYPE, NUMBER_RANGE_TYPE, firstValidationError } from "../domain/validation.mjs";
import {
  INVALID_PIVOT_MESSAGE,
  PIVOT_SOURCE_MISSING_MESSAGE,
  buildPivotCells,
  defaultPivotConfig,
  nextPivotName,
  normalizePivotConfig,
} from "../domain/pivot.mjs";

// The HTTP layer only knows these two error types; they stay importable here.
export { NotFoundError, ValidationError };

/** Seeded workbook shown on the home page for a fresh (empty) data directory. */
export const SEED_WORKBOOK_ID = "wb-q3-sales";
export const SEED_WORKSHEET_ID = "ws-q3-sheet1";
export const SEED_SECOND_WORKSHEET_ID = "ws-q3-sheet2";
export const SEED_CREATED_AT = "2026-09-21T09:00:00.000Z";
export const SEED_UPDATED_AT = "2026-09-28T14:05:00.000Z";
export const DEFAULT_WORKBOOK_NAME = "Untitled workbook";
export const DEFAULT_WORKSHEET_NAME = "Sheet1";
export const EMPTY_NAME_MESSAGE = "Workbook name cannot be empty";
export const EMPTY_WORKSHEET_NAME_MESSAGE = "Worksheet name cannot be empty";
export const DUPLICATE_WORKSHEET_NAME_MESSAGE = "Worksheet name already exists";
export const LAST_WORKSHEET_MESSAGE = "A workbook must contain at least one worksheet";
export const PIVOT_SOURCE_DEPENDENCY_MESSAGE = "Please delete or rebuild dependent pivot tables first";
export const INVALID_CSV_MESSAGE = "Invalid CSV file format. Import failed.";
export const UNKNOWN_CELL_MESSAGE = "Unknown cell reference";
export const INVALID_CELL_VALUE_MESSAGE = "Cell value must be a string";
export const INVALID_STRUCTURE_MESSAGE = "Invalid row or column change";
export const INVALID_RANGE_MESSAGE = "Invalid cell range update";
export const INVALID_TRANSFER_MESSAGE = "Invalid range transfer";
export const INVALID_STATE_MESSAGE = "Invalid worksheet state";
export const INVALID_RULE_MESSAGE = "Invalid validation rule";
export const INVALID_FILTER_MESSAGE = "Invalid filter";
export const INVALID_SORT_MESSAGE = "Invalid sort request";

/** Selection of a worksheet with no recorded history: cell A1. */
export const DEFAULT_SELECTION = { anchor: "A1", focus: "A1" };

/**
 * Shared evaluation seed. Worksheet `Sheet1` holds the seeded cell `A1 = Region`
 * plus the header row and region rows other requirements reference on the same
 * workbook (`Region/Sales/Status`, `East/1200/Open`, `North/800/Closed`,
 * `South/700/Open`). A second, blank `Sheet2` is seeded so the workbook has two
 * independent worksheets out of the box.
 */
export function createSeedState() {
  return {
    workbooks: [
      {
        id: SEED_WORKBOOK_ID,
        name: "Q3 Sales",
        createdAt: SEED_CREATED_AT,
        updatedAt: SEED_UPDATED_AT,
        activeWorksheetId: SEED_WORKSHEET_ID,
        worksheets: [
          {
            id: SEED_WORKSHEET_ID,
            name: DEFAULT_WORKSHEET_NAME,
            selection: { anchor: "A1", focus: "A1" },
            cells: {
              A1: "Region",
              B1: "Sales",
              C1: "Status",
              A2: "East",
              B2: "1200",
              C2: "Open",
              A3: "North",
              B3: "800",
              C3: "Closed",
              A4: "South",
              B4: "700",
              C4: "Open",
            },
          },
          {
            id: SEED_SECOND_WORKSHEET_ID,
            name: "Sheet2",
            selection: { anchor: "A1", focus: "A1" },
            cells: {},
          },
        ],
      },
    ],
  };
}

export function summarizeWorkbook(workbook) {
  return {
    id: workbook.id,
    name: workbook.name,
    createdAt: workbook.createdAt,
    updatedAt: workbook.updatedAt,
    activeWorksheetId: workbook.activeWorksheetId,
    worksheetCount: workbook.worksheets.length,
  };
}

function normalizeName(value) {
  if (typeof value !== "string") throw new ValidationError(EMPTY_NAME_MESSAGE);
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError(EMPTY_NAME_MESSAGE);
  return trimmed;
}

/**
 * Name for a newly created workbook. Creation may omit the name entirely, in
 * which case the blank workbook keeps the default `Untitled workbook` name;
 * renaming an existing workbook still rejects an empty name.
 */
function normalizeWorksheetName(value) {
  if (typeof value !== "string") throw new ValidationError(EMPTY_WORKSHEET_NAME_MESSAGE);
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError(EMPTY_WORKSHEET_NAME_MESSAGE);
  return trimmed;
}

/**
 * First unused `SheetN` name in positive-integer order, so a workbook with
 * only `Sheet1` yields `Sheet2` and one with `Sheet1`/`Sheet2` yields `Sheet3`.
 */
export function nextWorksheetName(worksheets) {
  const used = new Set(worksheets.map((worksheet) => worksheet.name));
  let index = 1;
  while (used.has(`Sheet${index}`)) index += 1;
  return `Sheet${index}`;
}

function normalizeCreateName(value) {
  if (typeof value !== "string") return DEFAULT_WORKBOOK_NAME;
  return value.trim() || DEFAULT_WORKBOOK_NAME;
}

/** 1-based line index of a row/column change, or throws `ValidationError`. */
function normalizeLineIndex(value) {
  if (!Number.isInteger(value) || value < 1) throw new ValidationError(INVALID_STRUCTURE_MESSAGE);
  return value;
}

/** Maps a structure request onto the pure domain change, or throws `ValidationError`. */
function structureChange(cells, { axis, mode, index }) {
  if (!STRUCTURE_AXES.includes(axis) || !STRUCTURE_MODES.includes(mode)) {
    throw new ValidationError(INVALID_STRUCTURE_MESSAGE);
  }
  const target = normalizeLineIndex(index);
  if (mode === "delete") {
    return axis === "row" ? deleteRow(cells, target) : deleteColumn(cells, target);
  }
  const at = mode === "insert-after" ? target + 1 : target;
  return axis === "row" ? insertRow(cells, at) : insertColumn(cells, at);
}

/** Uppercases and validates an A1 coordinate, or throws `ValidationError`. */
function normalizeCoordinate(value) {
  const parsed = typeof value === "string" ? parseCellName(value) : null;
  if (!parsed) throw new ValidationError(UNKNOWN_CELL_MESSAGE);
  return cellName(parsed.row, parsed.column);
}

/**
 * Canonical A1 area for a rule: a single cell stays `A1`, a rectangle becomes
 * `A1:B2` with top-left/bottom-right ordering. Throws `ValidationError` for
 * anything that is not an A1 cell or area.
 */
function normalizeRuleRange(value) {
  if (typeof value !== "string") throw new ValidationError(INVALID_RULE_MESSAGE);
  const parts = value.trim().split(":");
  if (parts.length < 1 || parts.length > 2) throw new ValidationError(INVALID_RULE_MESSAGE);
  const first = parseCellName(parts[0]);
  const last = parts.length === 2 ? parseCellName(parts[1]) : first;
  if (!first || !last) throw new ValidationError(INVALID_RULE_MESSAGE);
  const top = Math.min(first.row, last.row);
  const bottom = Math.max(first.row, last.row);
  const left = Math.min(first.column, last.column);
  const right = Math.max(first.column, last.column);
  const start = cellName(top, left);
  const end = cellName(bottom, right);
  return start === end ? start : `${start}:${end}`;
}

/** Validated, canonical rule payload, or throws `ValidationError`. */
function normalizeRule({ range, type, min, max, values } = {}) {
  const normalizedRange = normalizeRuleRange(range);
  if (type === NUMBER_RANGE_TYPE) {
    const low = typeof min === "number" ? min : Number(min);
    const high = typeof max === "number" ? max : Number(max);
    if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) {
      throw new ValidationError(INVALID_RULE_MESSAGE);
    }
    return { range: normalizedRange, type, min: low, max: high };
  }
  if (type === DROPDOWN_TYPE) {
    const allowed = Array.isArray(values)
      ? values.map((value) => String(value).trim()).filter((value) => value !== "")
      : [];
    if (allowed.length === 0) throw new ValidationError(INVALID_RULE_MESSAGE);
    return { range: normalizedRange, type, values: allowed };
  }
  throw new ValidationError(INVALID_RULE_MESSAGE);
}

/** True when two rule ranges cover the same rectangle. */
function sameRuleRange(a, b) {
  try {
    return normalizeRuleRange(a) === normalizeRuleRange(b);
  } catch {
    return false;
  }
}

/** Validated, canonical filter view, or throws `ValidationError`. */
function normalizeFilter(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(INVALID_FILTER_MESSAGE);
  }
  let range;
  try {
    range = normalizeRuleRange(value.range);
  } catch {
    // A malformed area is a filter error here, not a rule error.
    throw new ValidationError(INVALID_FILTER_MESSAGE);
  }
  if (!Array.isArray(value.columns)) throw new ValidationError(INVALID_FILTER_MESSAGE);
  const columns = value.columns.map((column) => {
    if (column === null || typeof column !== "object" || Array.isArray(column)) {
      throw new ValidationError(INVALID_FILTER_MESSAGE);
    }
    const index = column.column;
    if (!Number.isInteger(index) || index < 1) throw new ValidationError(INVALID_FILTER_MESSAGE);
    const header = typeof column.header === "string" ? column.header : "";
    if (column.mode === "values") {
      const values = Array.isArray(column.values) ? column.values.map((entry) => String(entry)) : [];
      return { column: index, header, mode: "values", values };
    }
    if (column.mode === "condition") {
      if (!FILTER_CONDITIONS.includes(column.condition)) throw new ValidationError(INVALID_FILTER_MESSAGE);
      const text = typeof column.value === "string" ? column.value : "";
      return { column: index, header, mode: "condition", condition: column.condition, value: text };
    }
    throw new ValidationError(INVALID_FILTER_MESSAGE);
  });
  return { range, columns };
}

/** Canonical A1 area of a pivot's source range, or throws `ValidationError`. */
function normalizePivotRange(value) {
  const bounds = typeof value === "string" ? parseArea(value) : null;
  if (!bounds) throw new ValidationError(INVALID_PIVOT_MESSAGE);
  const start = cellName(bounds.top, bounds.left);
  const end = cellName(bounds.bottom, bounds.right);
  return start === end ? start : `${start}:${end}`;
}

/**
 * Recomputes one pivot worksheet from its source worksheet inside the current
 * draft: the field layout is stored and the summary replaces the worksheet's
 * cells. A field that is no longer a header of the stored range rejects before
 * anything is written, so the last successful summary stays visible.
 */
function writePivotTable(workbook, worksheet, config) {
  const source = workbook.worksheets.find((candidate) => candidate.id === worksheet.pivot.sourceWorksheetId);
  if (!source) throw new ValidationError(PIVOT_SOURCE_MISSING_MESSAGE);
  worksheet.cells = buildPivotCells({
    cells: source.cells,
    range: worksheet.pivot.range,
    ...config,
  });
  worksheet.pivot = { ...worksheet.pivot, ...config };
  workbook.updatedAt = new Date().toISOString();
}

/** Workbook name for an imported CSV: the file name without its final `.csv` extension. */
export function workbookNameFromFileName(fileName) {
  const raw = typeof fileName === "string" ? fileName.trim() : "";
  const base = raw.replace(/\.csv$/i, "").trim();
  return base || DEFAULT_WORKBOOK_NAME;
}

function assertRows(rows) {
  if (!Array.isArray(rows)) throw new ValidationError(INVALID_CSV_MESSAGE);
  for (const row of rows) {
    if (!Array.isArray(row)) throw new ValidationError(INVALID_CSV_MESSAGE);
    for (const cell of row) {
      if (typeof cell !== "string") throw new ValidationError(INVALID_CSV_MESSAGE);
    }
  }
}

/** A1-keyed map of text values required by a state restore; anything else is rejected. */
function assertCellMap(cells) {
  if (cells === null || typeof cells !== "object" || Array.isArray(cells)) {
    throw new ValidationError(INVALID_STATE_MESSAGE);
  }
  for (const value of Object.values(cells)) {
    if (typeof value !== "string") throw new ValidationError(INVALID_STATE_MESSAGE);
  }
}

/** Row-major strings required by a bulk range write; anything else is rejected. */
function assertRangeRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new ValidationError(INVALID_RANGE_MESSAGE);
  for (const row of rows) {
    if (!Array.isArray(row)) throw new ValidationError(INVALID_RANGE_MESSAGE);
    for (const cell of row) {
      if (typeof cell !== "string") throw new ValidationError(INVALID_RANGE_MESSAGE);
    }
  }
}

export function createWorkbookStore({ dataDir } = {}) {
  const filePath = join(dataDir ?? ".", "workbooks.json");
  const store = createJsonStore(filePath, createSeedState());

  return {
    async listWorkbooks() {
      const state = await store.read();
      return [...state.workbooks]
        .sort((a, b) => (a.updatedAt === b.updatedAt ? a.id.localeCompare(b.id) : b.updatedAt.localeCompare(a.updatedAt)))
        .map(summarizeWorkbook);
    },

    async getWorkbook(id) {
      const state = await store.read();
      return state.workbooks.find((workbook) => workbook.id === id) ?? null;
    },

    async createWorkbook({ name } = {}) {
      const now = new Date().toISOString();
      const worksheetId = randomUUID();
      const workbook = {
        id: randomUUID(),
        name: normalizeCreateName(name),
        createdAt: now,
        updatedAt: now,
        activeWorksheetId: worksheetId,
        worksheets: [{ id: worksheetId, name: DEFAULT_WORKSHEET_NAME, selection: { ...DEFAULT_SELECTION }, cells: {} }],
      };
      await store.update((state) => {
        state.workbooks.push(workbook);
      });
      return workbook;
    },

    /**
     * Creates a workbook from parsed CSV rows. The whole import is one atomic
     * write, so a rejected payload leaves the stored state untouched.
     */
    async importWorkbook({ fileName, rows } = {}) {
      assertRows(rows);
      const now = new Date().toISOString();
      const worksheetId = randomUUID();
      const workbook = {
        id: randomUUID(),
        name: workbookNameFromFileName(fileName),
        createdAt: now,
        updatedAt: now,
        activeWorksheetId: worksheetId,
        worksheets: [
          { id: worksheetId, name: DEFAULT_WORKSHEET_NAME, selection: { ...DEFAULT_SELECTION }, cells: cellsFromRows(rows) },
        ],
      };
      await store.update((state) => {
        state.workbooks.push(workbook);
      });
      return workbook;
    },

    /**
     * Writes one cell of one worksheet. An empty string clears the cell, so a
     * cleared cell leaves the used range instead of storing an empty value. The
     * whole update is a single atomic write: a rejected payload (unknown
     * worksheet or malformed coordinate) leaves the stored state untouched.
     */
    async updateCell({ workbookId, worksheetId, coordinate, value } = {}) {
      if (typeof value !== "string") throw new ValidationError(INVALID_CELL_VALUE_MESSAGE);
      const key = normalizeCoordinate(coordinate);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const violation = firstValidationError(worksheet.validationRules, [{ coordinate: key, value }]);
          if (violation) throw new ValidationError(violation);
          if (value === "") {
            delete worksheet.cells[key];
          } else {
            worksheet.cells[key] = value;
          }
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Applies a rectangle of text values starting at `start` (row-major `rows`)
     * in a single atomic write. Every cell in the rectangle is written or
     * cleared together: an unknown coordinate, a malformed payload or any
     * rejected validation target leaves the stored worksheet untouched, so a
     * paste never drops only some of its values.
     */
    async applyCellRange({ workbookId, worksheetId, start, rows } = {}) {
      assertRangeRows(rows);
      const origin = typeof start === "string" ? parseCellName(start) : null;
      if (!origin) throw new ValidationError(UNKNOWN_CELL_MESSAGE);
      const updates = [];
      rows.forEach((row, rowIndex) => {
        row.forEach((value, columnIndex) => {
          updates.push({ coordinate: cellName(origin.row + rowIndex, origin.column + columnIndex), value });
        });
      });
      if (updates.length === 0) throw new ValidationError(INVALID_RANGE_MESSAGE);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const violation = firstValidationError(worksheet.validationRules, updates);
          if (violation) throw new ValidationError(violation);
          for (const { coordinate, value } of updates) {
            if (value === "") delete worksheet.cells[coordinate];
            else worksheet.cells[coordinate] = value;
          }
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Transfers a rectangle onto `target` in one atomic write: the target cells
     * are written (an empty field clears the cell) and, for a cut, every cell of
     * the optional `source` area that is not part of the target is cleared. The
     * whole transfer is validated against the worksheet's rules before the write,
     * so a rejected move changes neither the source nor the target. Cells outside
     * both rectangles are never touched.
     */
    async transferRange({ workbookId, worksheetId, target, rows, source } = {}) {
      assertRangeRows(rows);
      const origin = typeof target === "string" ? parseCellName(target) : null;
      if (!origin) throw new ValidationError(UNKNOWN_CELL_MESSAGE);
      const clearBounds = source === undefined || source === null || source === "" ? null : parseArea(source);
      if (source !== undefined && source !== null && source !== "" && !clearBounds) {
        throw new ValidationError(INVALID_TRANSFER_MESSAGE);
      }
      const updates = [];
      rows.forEach((row, rowIndex) => {
        row.forEach((value, columnIndex) => {
          updates.push({ coordinate: cellName(origin.row + rowIndex, origin.column + columnIndex), value });
        });
      });
      if (updates.length === 0) throw new ValidationError(INVALID_TRANSFER_MESSAGE);
      const written = new Set(updates.map((update) => update.coordinate));
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const violation = firstValidationError(worksheet.validationRules, updates);
          if (violation) throw new ValidationError(violation);
          for (const { coordinate, value } of updates) {
            if (value === "") delete worksheet.cells[coordinate];
            else worksheet.cells[coordinate] = value;
          }
          if (clearBounds) {
            for (let row = clearBounds.top; row <= clearBounds.bottom; row += 1) {
              for (let column = clearBounds.left; column <= clearBounds.right; column += 1) {
                const coordinate = cellName(row, column);
                if (!written.has(coordinate)) delete worksheet.cells[coordinate];
              }
            }
          }
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Replaces a worksheet's content in one atomic write. Used to restore a
     * previously persisted state (undo/redo); `cells` is an A1-keyed map and
     * `validationRules` an optional rule list. Other worksheets and workbooks
     * are never modified.
     */
    async replaceWorksheetState({ workbookId, worksheetId, cells, validationRules } = {}) {
      assertCellMap(cells);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const next = {};
          for (const [coordinate, value] of Object.entries(cells)) {
            if (value === "") continue;
            const parsed = parseCellName(coordinate);
            if (!parsed) continue;
            next[cellName(parsed.row, parsed.column)] = value;
          }
          worksheet.cells = next;
          if (Array.isArray(validationRules)) worksheet.validationRules = validationRules;
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Persists the complete rectangle of a worksheet's most recent successful
     * selection. Only this worksheet changes, so switching ahead and back keeps
     * each worksheet's own rectangle. Selection is view state and does not bump
     * the workbook's last-updated time.
     */
    async selectRange({ workbookId, worksheetId, anchor, focus } = {}) {
      const from = normalizeCoordinate(anchor);
      const to = normalizeCoordinate(focus);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          worksheet.selection = { anchor: from, focus: to };
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Creates or replaces the validation rule covering one A1 range. Any
     * existing rule with the same range is replaced, other rules are kept, and
     * the whole change is one atomic write. Cell values are never touched, so a
     * rejected payload leaves the stored worksheet unchanged.
     */
    async setValidationRule({ workbookId, worksheetId, range, type, min, max, values } = {}) {
      const rule = normalizeRule({ range, type, min, max, values });
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const kept = (Array.isArray(worksheet.validationRules) ? worksheet.validationRules : []).filter(
            (existing) => !sameRuleRange(existing?.range, rule.range),
          );
          worksheet.validationRules = [...kept, rule];
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Removes every rule covering the given A1 range in one atomic write. Cell
     * values and the worksheet's other rules are left untouched.
     */
    async deleteValidationRule({ workbookId, worksheetId, range } = {}) {
      const target = normalizeRuleRange(range);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          const kept = (Array.isArray(worksheet.validationRules) ? worksheet.validationRules : []).filter(
            (existing) => !sameRuleRange(existing?.range, target),
          );
          if (kept.length === 0) delete worksheet.validationRules;
          else worksheet.validationRules = kept;
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Reorders the records of one A1 range by one of its columns in a single
     * atomic write. Every record (the cells of one row inside the range) moves
     * as a unit, so values outside the range and every other worksheet stay as
     * they were, and formula row references follow their record. A rejected
     * payload leaves the stored grid in its original order.
     */
    async sortRange({ workbookId, worksheetId, range, column, order, hasHeaderRow } = {}) {
      const bounds = parseArea(range);
      if (!bounds) throw new ValidationError(INVALID_SORT_MESSAGE);
      if (!Number.isInteger(column) || column < bounds.left || column > bounds.right) {
        throw new ValidationError(INVALID_SORT_MESSAGE);
      }
      if (!SORT_ORDERS.includes(order)) throw new ValidationError(INVALID_SORT_MESSAGE);
      if (typeof hasHeaderRow !== "boolean") throw new ValidationError(INVALID_SORT_MESSAGE);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          worksheet.cells = sortRangeCells(worksheet.cells, { range, column, order, hasHeaderRow });
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Creates or replaces a worksheet's filter view in one atomic write. Only
     * the stored view changes, so hidden rows keep their values, order and
     * rules; a rejected payload leaves the stored worksheet untouched.
     */
    async setFilter({ workbookId, worksheetId, filter } = {}) {
      const normalized = normalizeFilter(filter);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          worksheet.filter = normalized;
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Removes a worksheet's filter view in one atomic write; every record of
     * the range becomes visible again with its original value and position.
     */
    async clearFilter({ workbookId, worksheetId } = {}) {
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          delete worksheet.filter;
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Creates a pivot table from a source range with headers. The result lives
     * on its own worksheet named after the first unused `PivotN`, which becomes
     * the active worksheet; the source cells are only read. One atomic write, so
     * an unknown range leaves the workbook (and both worksheets) untouched.
     */
    async createPivotTable({ workbookId, sourceWorksheetId, range } = {}) {
      const sourceRange = normalizePivotRange(range);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const source = workbook.worksheets.find((candidate) => candidate.id === sourceWorksheetId);
          if (!source) throw new ValidationError("Unknown worksheet");
          const config = defaultPivotConfig(source.cells, sourceRange);
          const worksheet = {
            id: randomUUID(),
            name: nextPivotName(workbook.worksheets),
            selection: { ...DEFAULT_SELECTION },
            cells: buildPivotCells({ cells: source.cells, range: sourceRange, ...config }),
            pivot: { sourceWorksheetId: source.id, range: sourceRange, ...config },
          };
          workbook.worksheets.push(worksheet);
          workbook.activeWorksheetId = worksheet.id;
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Replaces a pivot worksheet's field layout and recomputes its summary. An
     * unknown field or a value field without numbers rejects with its message
     * and leaves the last successful result as well as the source worksheet
     * exactly as they were.
     */
    async applyPivotConfig({ workbookId, worksheetId, rowField, columnField, valueField, summarizeBy } = {}) {
      const config = normalizePivotConfig({ rowField, columnField, valueField, summarizeBy });
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          if (!worksheet.pivot) throw new ValidationError(INVALID_PIVOT_MESSAGE);
          writePivotTable(workbook, worksheet, config);
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Recomputes a pivot worksheet with its stored field layout against the
     * current source range. Used after the source data or its rows/columns
     * changed; the whole summary is replaced, or nothing changes at all.
     */
    async refreshPivotTable({ workbookId, worksheetId } = {}) {
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          if (!worksheet.pivot) throw new ValidationError(INVALID_PIVOT_MESSAGE);
          const { rowField, columnField, valueField, summarizeBy } = worksheet.pivot;
          writePivotTable(workbook, worksheet, { rowField, columnField, valueField, summarizeBy });
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Adds a blank worksheet using the first unused `SheetN` name and makes it
     * the active worksheet. One atomic write: a rejected call (unknown
     * workbook) leaves the stored state untouched.
     */
    async addWorksheet({ workbookId } = {}) {
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = {
            id: randomUUID(),
            name: nextWorksheetName(workbook.worksheets),
            selection: { ...DEFAULT_SELECTION },
            cells: {},
          };
          workbook.worksheets.push(worksheet);
          workbook.activeWorksheetId = worksheet.id;
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Renames one worksheet after trimming. The new name must not be empty and
     * must be unique within the same workbook; both failures reject with a
     * `ValidationError` and leave the stored state (including the old name)
     * untouched, since the name is validated before the atomic write.
     */
    async renameWorksheet({ workbookId, worksheetId, name } = {}) {
      const trimmed = normalizeWorksheetName(name);
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          if (workbook.worksheets.some((candidate) => candidate.id !== worksheetId && candidate.name === trimmed)) {
            throw new ValidationError(DUPLICATE_WORKSHEET_NAME_MESSAGE);
          }
          worksheet.name = trimmed;
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Deletes one worksheet in a single atomic write. A workbook always keeps
     * at least one worksheet, so the last remaining one is rejected with
     * `LAST_WORKSHEET_MESSAGE`. A worksheet that is still the source of a
     * pivot result stored on another worksheet is rejected with
     * `PIVOT_SOURCE_DEPENDENCY_MESSAGE`; deleting the pivot result worksheet
     * first (or rebuilding it on another source) lifts that constraint because
     * the dependency is derived from the stored pivot configs. When the deleted
     * worksheet was active, an adjacent worksheet becomes active. A rejected
     * call leaves every worksheet (and every pivot result) untouched.
     */
    async deleteWorksheet({ workbookId, worksheetId } = {}) {
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const index = workbook.worksheets.findIndex((candidate) => candidate.id === worksheetId);
          if (index === -1) throw new ValidationError("Unknown worksheet");
          if (workbook.worksheets.length <= 1) throw new ValidationError(LAST_WORKSHEET_MESSAGE);
          const dependent = workbook.worksheets.some(
            (candidate) => candidate.id !== worksheetId && candidate.pivot?.sourceWorksheetId === worksheetId,
          );
          if (dependent) throw new ValidationError(PIVOT_SOURCE_DEPENDENCY_MESSAGE);
          workbook.worksheets.splice(index, 1);
          if (workbook.activeWorksheetId === worksheetId) {
            // The tab to the left if it exists, otherwise the new first tab:
            // either way an adjacent worksheet of the deleted one becomes active.
            const neighbour = workbook.worksheets[Math.max(0, index - 1)] ?? workbook.worksheets[0];
            workbook.activeWorksheetId = neighbour.id;
          }
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    /**
     * Inserts or deletes one row or column of one worksheet. Cells, formula
     * references and everything after the target line move together in a single
     * atomic write, so a rejected request leaves the stored grid untouched and
     * other worksheets are never modified.
     */
    async changeStructure({ workbookId, worksheetId, axis, mode, index } = {}) {
      return store
        .update((state) => {
          const workbook = state.workbooks.find((candidate) => candidate.id === workbookId);
          if (!workbook) throw new NotFoundError("Workbook not found");
          const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
          if (!worksheet) throw new ValidationError("Unknown worksheet");
          worksheet.cells = structureChange(worksheet.cells, { axis, mode, index });
          // Validation rules and the filter view follow their cells, so
          // dropdown buttons and numeric limits stay on the same records.
          const shiftedRules = shiftRuleRanges(worksheet.validationRules, { axis, mode, index });
          if (Array.isArray(shiftedRules) && shiftedRules.length > 0) worksheet.validationRules = shiftedRules;
          else delete worksheet.validationRules;
          if (worksheet.filter) {
            const shifted = shiftFilter(worksheet.filter, { axis, mode, index });
            if (shifted) worksheet.filter = shifted;
            else delete worksheet.filter;
          }
          // Pivot tables reading this worksheet move their stored source range
          // with the cells, so a later refresh reads the adjusted data.
          for (const other of workbook.worksheets) {
            if (!other.pivot || other.pivot.sourceWorksheetId !== worksheet.id) continue;
            const moved = shiftPivot(other.pivot, { axis, mode, index });
            if (moved) other.pivot = moved;
          }
          workbook.updatedAt = new Date().toISOString();
        })
        .then((state) => state.workbooks.find((workbook) => workbook.id === workbookId) ?? null);
    },

    async updateWorkbook(id, changes = {}) {
      return store.update((state) => {
        const workbook = state.workbooks.find((candidate) => candidate.id === id);
        if (!workbook) throw new NotFoundError("Workbook not found");
        if (changes.name !== undefined) {
          workbook.name = normalizeName(changes.name);
        }
        if (changes.activeWorksheetId !== undefined) {
          const target = workbook.worksheets.find((worksheet) => worksheet.id === changes.activeWorksheetId);
          if (!target) throw new ValidationError("Unknown worksheet");
          workbook.activeWorksheetId = target.id;
        }
        workbook.updatedAt = new Date().toISOString();
        return state;
      }).then((state) => state.workbooks.find((workbook) => workbook.id === id));
    },
  };
}

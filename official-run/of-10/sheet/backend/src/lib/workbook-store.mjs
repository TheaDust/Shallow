import { randomUUID } from "node:crypto";
import { join } from "node:path";

import {
  DEFAULT_COLUMN_COUNT,
  DEFAULT_ROW_COUNT,
  clampAddress,
  clampRegion,
  makeCellId,
  parseCellId,
  parseRegionRef,
  readRegion,
  regionHasCell,
} from "./cells.mjs";
import { parseCsv } from "./csv.mjs";
import { WorkbookError } from "./errors.mjs";
import { normalizeFilter, readStoredFilter } from "./filters.mjs";
import { computeWorksheetCells, translateFormulaReferences } from "./formula.mjs";
import { createHistoryLog } from "./history.mjs";
import { createJsonStore } from "./json-store.mjs";
import {
  INVALID_PIVOT_SOURCE_MESSAGE,
  NOT_A_PIVOT_MESSAGE,
  PIVOT_RANGE_REQUIRED_MESSAGE,
  computePivot,
  createPivotConfig,
  normalizePivotConfig,
  readStoredPivot,
  sourceHeaders,
} from "./pivot.mjs";
import { createSeedState } from "./seed.mjs";
import { applySortChange, readSortChange } from "./sort.mjs";
import { applyPivotSourceShift, applyStructureChange, readStructureChange } from "./structure.mjs";
import { findViolation, normalizeValidationRule } from "./validation.mjs";

export { WorkbookError } from "./errors.mjs";

const DEFAULT_WORKBOOK_NAME = "Untitled workbook";
const MAX_CELL_VALUE_LENGTH = 50_000;
const MAX_PASTE_ROWS = 5_000;
const MAX_PASTE_COLUMNS = 500;

/** Refusal of `Delete` when the workbook would be left without any worksheet (REQ-2-1-4). */
export const LAST_WORKSHEET_MESSAGE = "A workbook must contain at least one worksheet";
/** Refusal of `Delete` while a pivot table still reads the worksheet (REQ-2-1-4). */
export const PIVOT_DEPENDENCY_MESSAGE = "Please delete or rebuild dependent pivot tables first";

/** A range move never rewrites a formula that is not a formula. */
function transferredValue(value, mode, rowOffset, columnOffset) {
  if (mode !== "copy") return value;
  return translateFormulaReferences(value, rowOffset, columnOffset);
}

/**
 * The writes of one range transfer: the source rectangle re-targeted at `target`, plus the source
 * cells a cut clears (never a cell the target rectangle itself covers).
 */
function transferEntries(worksheet, mode, source, target) {
  const height = source.bottom - source.top + 1;
  const width = source.right - source.left + 1;
  const rowOffset = target.row - source.top;
  const columnOffset = target.column - source.left;
  const targetRegion = {
    top: target.row,
    bottom: target.row + height - 1,
    left: target.column,
    right: target.column + width - 1,
  };
  const writes = [];
  const clears = [];
  for (let row = source.top; row <= source.bottom; row += 1) {
    for (let column = source.left; column <= source.right; column += 1) {
      const sourceId = makeCellId(row, column);
      const value = worksheet.cells[sourceId]?.value ?? "";
      writes.push({
        cellId: makeCellId(row + rowOffset, column + columnOffset),
        value: transferredValue(value, mode, rowOffset, columnOffset),
      });
      if (mode === "cut" && !regionHasCell(targetRegion, { row, column })) {
        clears.push({ cellId: sourceId, value: "" });
      }
    }
  }
  return { writes, clears, height, width };
}

function makeId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function defaultSelection() {
  return { anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } };
}

function toAddress(value) {
  const row = Number(value?.row);
  const column = Number(value?.column);
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 1 || column < 1) return null;
  return { row, column };
}

function readSelection(selection) {
  const anchor = toAddress(selection?.anchor);
  const focus = toAddress(selection?.focus);
  if (!anchor || !focus) return null;
  return { anchor, focus };
}

/** Old store files predate selections, validation rules, filter views and calculated cell displays. */
function normalizeWorksheet(worksheet) {
  const rowCount = Number.isInteger(worksheet.rowCount) ? worksheet.rowCount : DEFAULT_ROW_COUNT;
  const columnCount = Number.isInteger(worksheet.columnCount) ? worksheet.columnCount : DEFAULT_COLUMN_COUNT;
  worksheet.rowCount = rowCount;
  worksheet.columnCount = columnCount;
  worksheet.validations = Array.isArray(worksheet.validations) ? worksheet.validations : [];
  worksheet.filter = readStoredFilter(worksheet.filter);
  worksheet.pivot = readStoredPivot(worksheet.pivot);
  const selection = readSelection(worksheet.selection) ?? defaultSelection();
  worksheet.selection = {
    anchor: clampAddress(selection.anchor, rowCount, columnCount),
    focus: clampAddress(selection.focus, rowCount, columnCount),
  };
  worksheet.cells = computeWorksheetCells(worksheet.cells);
  return worksheet;
}

function normalizeWorkbook(workbook) {
  if (!workbook) return workbook;
  workbook.worksheets = Array.isArray(workbook.worksheets)
    ? workbook.worksheets.map(normalizeWorksheet)
    : [];
  return workbook;
}

export function workbookNameFromFileName(fileName) {
  const base = String(fileName ?? "").split(/[\\/]/).pop() ?? "";
  const withoutExtension = base.replace(/\.[cC][sS][vV]$/, "");
  const name = withoutExtension.trim();
  return name === "" ? "Imported workbook" : name;
}

function toSummary(workbook) {
  return { id: workbook.id, name: workbook.name, updatedAt: workbook.updatedAt };
}

function findWorkbook(state, id) {
  return state.workbooks.find((workbook) => workbook.id === id) ?? null;
}

function findWorksheet(workbook, worksheetId) {
  return workbook?.worksheets.find((worksheet) => worksheet.id === worksheetId) ?? null;
}

/** Names a new worksheet follows: the first unused `SheetN` in positive-integer order. */
const DEFAULT_SHEET_NAME = /^sheet(\d+)$/i;

function firstUnusedSheetName(workbook) {
  const used = new Set();
  for (const worksheet of workbook.worksheets) {
    const match = DEFAULT_SHEET_NAME.exec(String(worksheet.name ?? "").trim());
    if (match) used.add(Number(match[1]));
  }
  let index = 1;
  while (used.has(index)) index += 1;
  return `Sheet${index}`;
}

function readWorksheetName(name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed === "") throw new WorkbookError("Worksheet name cannot be empty");
  return trimmed;
}

/** A worksheet name is unique inside its workbook, ignoring case and surrounding spaces. */
function worksheetNameTaken(workbook, name, exceptWorksheetId) {
  const key = name.trim().toLowerCase();
  return workbook.worksheets.some(
    (worksheet) => worksheet.id !== exceptWorksheetId && String(worksheet.name ?? "").trim().toLowerCase() === key,
  );
}

/** Names a new pivot result worksheet follows: the first unused `PivotN` in positive-integer order. */
const DEFAULT_PIVOT_NAME = /^pivot(\d+)$/i;

function firstUnusedPivotName(workbook) {
  const used = new Set();
  for (const worksheet of workbook.worksheets) {
    const match = DEFAULT_PIVOT_NAME.exec(String(worksheet.name ?? "").trim());
    if (match) used.add(Number(match[1]));
  }
  let index = 1;
  while (used.has(index)) index += 1;
  return `Pivot${index}`;
}

function createBlankWorksheet(name) {
  return {
    id: makeId("ws"),
    name,
    rowCount: DEFAULT_ROW_COUNT,
    columnCount: DEFAULT_COLUMN_COUNT,
    cells: {},
    validations: [],
    filter: null,
    pivot: null,
    selection: defaultSelection(),
  };
}

function pasteGrid(values) {
  if (!Array.isArray(values) || values.length === 0) throw new WorkbookError("Nothing to paste");
  if (values.length > MAX_PASTE_ROWS) throw new WorkbookError("The pasted table is too large");
  return values.map((row) => {
    if (!Array.isArray(row)) throw new WorkbookError("Nothing to paste");
    if (row.length > MAX_PASTE_COLUMNS) throw new WorkbookError("The pasted table is too large");
    return row.map((cell) => {
      if (cell === null || cell === undefined) return "";
      const text = String(cell);
      if (text.length > MAX_CELL_VALUE_LENGTH) throw new WorkbookError("Cell value is too long");
      return text;
    });
  });
}

function writeEntries(worksheet, entries) {
  let rowCount = worksheet.rowCount;
  let columnCount = worksheet.columnCount;
  for (const entry of entries) {
    const address = parseCellId(entry.cellId);
    if (!address) continue;
    if (entry.value === "") delete worksheet.cells[entry.cellId];
    else worksheet.cells[entry.cellId] = { value: entry.value };
    rowCount = Math.max(rowCount, address.row);
    columnCount = Math.max(columnCount, address.column);
  }
  worksheet.rowCount = rowCount;
  worksheet.columnCount = columnCount;
  worksheet.cells = computeWorksheetCells(worksheet.cells);
}

export function createWorkbookRepository(dataDirectory) {
  const store = createJsonStore(join(dataDirectory, "workbooks.json"), createSeedState());
  const history = createHistoryLog();

  /** The undo history keeps whole worksheet states, so a restore also brings back formulas and rules. */
  function snapshotWorksheet(workbook, worksheetId) {
    const worksheet = findWorksheet(workbook, worksheetId);
    return worksheet ? structuredClone(worksheet) : null;
  }

  /**
   * Keeps one worksheet scoped operation in the session history once it is stored (REQ-3-2-2): a
   * cell edit, a bulk paste, a range move or a row/column structure change. A rejected operation
   * never reaches this point, and recording a new one drops the redo branch.
   */
  function recordChange(workbookId, worksheetId, before, storedWorkbook) {
    const after = snapshotWorksheet(storedWorkbook, worksheetId);
    if (!before || !after) return;
    history.record(workbookId, { worksheetId, before, after });
  }

  /** Writes one worksheet snapshot back over its worksheet and reports the new workbook state. */
  async function restoreSnapshot(workbookId, worksheetId, snapshot) {
    const next = await store.update((draft) => {
      const workbook = findWorkbook(draft, workbookId);
      if (!workbook) return;
      const index = workbook.worksheets.findIndex((worksheet) => worksheet.id === worksheetId);
      if (index === -1) return;
      workbook.worksheets[index] = structuredClone(snapshot);
      workbook.updatedAt = nowIso();
    });
    return normalizeWorkbook(findWorkbook(next, workbookId));
  }

  function createBlankWorkbook(name) {
    const trimmed = typeof name === "string" ? name.trim() : "";
    const timestamp = nowIso();
    const worksheet = createBlankWorksheet("Sheet1");
    return {
      id: makeId("wb"),
      name: trimmed === "" ? DEFAULT_WORKBOOK_NAME : trimmed,
      createdAt: timestamp,
      updatedAt: timestamp,
      activeWorksheetId: worksheet.id,
      worksheets: [worksheet],
    };
  }

  function createImportedWorkbook(name, rows) {
    const timestamp = nowIso();
    const cells = {};
    let columnCount = 0;
    rows.forEach((row, rowIndex) => {
      columnCount = Math.max(columnCount, row.length);
      row.forEach((text, columnIndex) => {
        if (text === "") return;
        cells[makeCellId(rowIndex + 1, columnIndex + 1)] = { value: text };
      });
    });
    const worksheet = { ...createBlankWorksheet("Sheet1"), rowCount: Math.max(DEFAULT_ROW_COUNT, rows.length), columnCount: Math.max(DEFAULT_COLUMN_COUNT, columnCount), cells };
    return {
      id: makeId("wb"),
      name,
      createdAt: timestamp,
      updatedAt: timestamp,
      activeWorksheetId: worksheet.id,
      worksheets: [worksheet],
    };
  }

  return {
    async list() {
      const state = await store.read();
      return state.workbooks
        .map(toSummary)
        .sort((left, right) => {
          if (left.updatedAt === right.updatedAt) return left.name.localeCompare(right.name);
          return left.updatedAt < right.updatedAt ? 1 : -1;
        });
    },

    async get(id) {
      const state = await store.read();
      return normalizeWorkbook(findWorkbook(state, id));
    },

    /** Whether this workbook has a change to undo or to redo in the current session. */
    historyState(workbookId) {
      return history.state(workbookId);
    },

    /**
     * Restores the state of the worksheet as it was before the most recent change of this workbook
     * (REQ-3-2-2): values, original formulas, row/column structure, validation rule ranges, the
     * filter view and the selection come back together, and dependents are recalculated from the
     * restored cells. The restore is written to the store, so a refresh shows the same state. The
     * log of a workbook only ever touches that workbook.
     */
    async undo(workbookId) {
      const state = await store.read();
      if (!findWorkbook(state, workbookId)) return null;
      const entry = history.stepBack(workbookId);
      if (!entry) throw new WorkbookError("There is nothing to undo", 409);
      return restoreSnapshot(workbookId, entry.worksheetId, entry.before);
    },

    /** Reapplies the operation the last undo removed, as one complete change. */
    async redo(workbookId) {
      const state = await store.read();
      if (!findWorkbook(state, workbookId)) return null;
      const entry = history.stepForward(workbookId);
      if (!entry) throw new WorkbookError("There is nothing to redo", 409);
      return restoreSnapshot(workbookId, entry.worksheetId, entry.after);
    },

    async create(name) {
      const workbook = createBlankWorkbook(name);
      await store.update((state) => {
        state.workbooks.push(workbook);
      });
      return normalizeWorkbook(workbook);
    },

    async update(id, patch = {}) {
      const state = await store.read();
      const existing = findWorkbook(state, id);
      if (!existing) return null;

      let name;
      if (patch.name !== undefined) {
        name = typeof patch.name === "string" ? patch.name.trim() : "";
        if (name === "") throw new WorkbookError("Workbook name cannot be empty");
      }

      let activeWorksheetId;
      if (patch.activeWorksheetId !== undefined) {
        const worksheet = findWorksheet(existing, patch.activeWorksheetId);
        if (!worksheet) throw new WorkbookError("Unknown worksheet");
        activeWorksheetId = worksheet.id;
      }

      const next = await store.update((draft) => {
        const workbook = findWorkbook(draft, id);
        if (!workbook) return;
        if (name !== undefined) {
          workbook.name = name;
          workbook.updatedAt = nowIso();
        }
        if (activeWorksheetId !== undefined) {
          workbook.activeWorksheetId = activeWorksheetId;
        }
      });
      return normalizeWorkbook(findWorkbook(next, id));
    },

    async setCell(workbookId, worksheetId, cellId, value) {
      if (typeof value !== "string") throw new WorkbookError("Cell value must be text");
      if (value.length > MAX_CELL_VALUE_LENGTH) throw new WorkbookError("Cell value is too long");
      const address = parseCellId(cellId);
      if (!address) throw new WorkbookError("Invalid cell address");

      const state = await store.read();
      const workbook = findWorkbook(state, workbookId);
      if (!workbook) return null;
      const worksheet = findWorksheet(workbook, worksheetId);
      if (!worksheet) throw new WorkbookError("Unknown worksheet", 404);

      const identifier = makeCellId(address.row, address.column);
      const violation = findViolation(worksheet, [{ cellId: identifier, value }]);
      if (violation) throw new WorkbookError(violation.message);
      const before = structuredClone(worksheet);

      const next = await store.update((draft) => {
        const target = findWorkbook(draft, workbookId);
        const sheet = findWorksheet(target, worksheetId);
        if (!sheet) return;
        writeEntries(sheet, [{ cellId: identifier, value }]);
        target.updatedAt = nowIso();
      });
      recordChange(workbookId, worksheetId, before, findWorkbook(next, workbookId));
      return normalizeWorkbook(findWorkbook(next, workbookId));
    },

    /**
     * Applies a pasted table starting at `startCellId`. Either every cell of the rectangle is
     * written, or a validation rule rejects the whole paste and no cell changes.
     */
    async pasteRange(workbookId, worksheetId, startCellId, values) {
      const start = parseCellId(startCellId);
      if (!start) throw new WorkbookError("Invalid cell address");
      const grid = pasteGrid(values);

      const entries = [];
      grid.forEach((row, rowIndex) => {
        row.forEach((text, columnIndex) => {
          entries.push({
            cellId: makeCellId(start.row + rowIndex, start.column + columnIndex),
            value: text,
          });
        });
      });
      if (entries.length === 0) throw new WorkbookError("Nothing to paste");

      const state = await store.read();
      const workbook = findWorkbook(state, workbookId);
      if (!workbook) return null;
      const worksheet = findWorksheet(workbook, worksheetId);
      if (!worksheet) throw new WorkbookError("Unknown worksheet", 404);

      const violation = findViolation(worksheet, entries);
      if (violation) throw new WorkbookError(violation.message);
      const before = structuredClone(worksheet);

      const next = await store.update((draft) => {
        const target = findWorkbook(draft, workbookId);
        const sheet = findWorksheet(target, worksheetId);
        if (!sheet) return;
        writeEntries(sheet, entries);
        target.updatedAt = nowIso();
      });
      recordChange(workbookId, worksheetId, before, findWorkbook(next, workbookId));
      return normalizeWorkbook(findWorkbook(next, workbookId));
    },

    /**
     * Copies or moves a rectangle inside one worksheet. A copy leaves the source untouched and
     * rewrites the relative references of copied formulas for the target offset; a cut writes the
     * target first and clears the source cells the target does not cover, in the same update. When a
     * validation rule rejects one of the target values the whole transfer is refused and nothing
     * (not even the source of a cut) changes.
     */
    async transferRange(workbookId, worksheetId, payload) {
      const requestedMode = payload?.mode;
      const mode = requestedMode === "copy" || requestedMode === "cut" ? requestedMode : null;
      if (!mode) throw new WorkbookError("Unknown range operation");
      const requestedSource = readRegion(payload?.source);
      if (!requestedSource) throw new WorkbookError("Select a range to copy or cut");
      const target = parseCellId(payload?.target);
      if (!target) throw new WorkbookError("Invalid target cell");

      const state = await store.read();
      const workbook = findWorkbook(state, workbookId);
      if (!workbook) return null;
      const worksheet = findWorksheet(workbook, worksheetId);
      if (!worksheet) throw new WorkbookError("Unknown worksheet", 404);

      const source = clampRegion(requestedSource, worksheet.rowCount, worksheet.columnCount);
      if (source.bottom - source.top + 1 > MAX_PASTE_ROWS || source.right - source.left + 1 > MAX_PASTE_COLUMNS) {
        throw new WorkbookError("The selected range is too large");
      }

      const { writes, clears } = transferEntries(worksheet, mode, source, target);

      const violation = findViolation(worksheet, writes);
      if (violation) throw new WorkbookError(violation.message);
      const before = structuredClone(worksheet);

      const next = await store.update((draft) => {
        const targetWorkbook = findWorkbook(draft, workbookId);
        const sheet = findWorksheet(targetWorkbook, worksheetId);
        if (!sheet) return;
        writeEntries(sheet, writes);
        if (clears.length > 0) writeEntries(sheet, clears);
        targetWorkbook.updatedAt = nowIso();
      });
      recordChange(workbookId, worksheetId, before, findWorkbook(next, workbookId));
      return normalizeWorkbook(findWorkbook(next, workbookId));
    },

    /** Adds a blank worksheet named with the first unused `SheetN`, and makes it the active one. */
    async createWorksheet(workbookId) {
      const state = await store.read();
      const existing = findWorkbook(state, workbookId);
      if (!existing) return null;
      const name = firstUnusedSheetName(existing);

      const next = await store.update((draft) => {
        const workbook = findWorkbook(draft, workbookId);
        if (!workbook) return;
        const worksheet = createBlankWorksheet(firstUnusedSheetName(workbook));
        workbook.worksheets.push(worksheet);
        workbook.activeWorksheetId = worksheet.id;
        workbook.updatedAt = nowIso();
      });
      return normalizeWorkbook(findWorkbook(next, workbookId));
    },

    /**
     * Deletes one worksheet (REQ-2-1-4): the tab disappears with its cells, formulas, validation
     * rules, filter view and pivot result, and the workbook keeps at least one worksheet. A
     * worksheet a pivot table still reads is refused until that pivot table is deleted, which also
     * releases the source. When the deleted worksheet was active, its adjacent worksheet becomes
     * active; the sessions history of that worksheet is dropped.
     */
    async deleteWorksheet(workbookId, worksheetId) {
      const state = await store.read();
      const workbook = findWorkbook(state, workbookId);
      if (!workbook) return null;
      const worksheet = findWorksheet(workbook, worksheetId);
      if (!worksheet) throw new WorkbookError("Unknown worksheet", 404);
      if (workbook.worksheets.length <= 1) throw new WorkbookError(LAST_WORKSHEET_MESSAGE);
      const reader = workbook.worksheets.find((candidate) => {
        const pivot = readStoredPivot(candidate.pivot);
        return pivot !== null && pivot.sourceWorksheetId === worksheetId;
      });
      if (reader) throw new WorkbookError(PIVOT_DEPENDENCY_MESSAGE);

      const next = await store.update((draft) => {
        const target = findWorkbook(draft, workbookId);
        if (!target) return;
        const index = target.worksheets.findIndex((candidate) => candidate.id === worksheetId);
        if (index === -1) return;
        const wasActive = target.activeWorksheetId === worksheetId;
        target.worksheets.splice(index, 1);
        if (wasActive) {
          const adjacent = target.worksheets[Math.min(index, target.worksheets.length - 1)];
          target.activeWorksheetId = adjacent.id;
        }
        target.updatedAt = nowIso();
      });
      history.dropWorksheet(workbookId, worksheetId);
      return normalizeWorkbook(findWorkbook(next, workbookId));
    },

    /** Renames one worksheet: the name is trimmed and must be non-empty and unique in the workbook. */
    async renameWorksheet(workbookId, worksheetId, name) {
      const requested = readWorksheetName(name);

      const state = await store.read();
      const workbook = findWorkbook(state, workbookId);
      if (!workbook) return null;
      const worksheet = findWorksheet(workbook, worksheetId);
      if (!worksheet) throw new WorkbookError("Unknown worksheet", 404);
      if (worksheetNameTaken(workbook, requested, worksheetId)) {
        throw new WorkbookError("Worksheet name already exists");
      }

      const next = await store.update((draft) => {
        const target = findWorkbook(draft, workbookId);
        const sheet = findWorksheet(target, worksheetId);
        if (!sheet) return;
        sheet.name = requested;
        target.updatedAt = nowIso();
      });
      return normalizeWorkbook(findWorkbook(next, workbookId));
    },

    /**
     * Inserts or deletes one row or column of a worksheet. The whole worksheet moves as one update:
     * cells, formula references, validation rules, the filter view and the selection follow the same
     * shift, and an operation that cannot be applied leaves the stored structure untouched.
     */
    async changeStructure(workbookId, worksheetId, payload) {
      const state = await store.read();
      const workbook = findWorkbook(state, workbookId);
      if (!workbook) return null;
      const worksheet = findWorksheet(workbook, worksheetId);
      if (!worksheet) throw new WorkbookError("Unknown worksheet", 404);
      const change = readStructureChange(worksheet, payload);
      const before = structuredClone(worksheet);

      const next = await store.update((draft) => {
        const target = findWorkbook(draft, workbookId);
        const sheet = findWorksheet(target, worksheetId);
        if (!sheet) return;
        applyStructureChange(sheet, change);
        applyPivotSourceShift(target, worksheetId, change);
        target.updatedAt = nowIso();
      });
      recordChange(workbookId, worksheetId, before, findWorkbook(next, workbookId));
      return normalizeWorkbook(findWorkbook(next, workbookId));
    },

    /**
     * Sorts one rectangular range of a worksheet by one of its columns (REQ-5-1-1). The records of
     * the range move as whole rows inside the same coordinates, so the cells, the rules, the filter
     * view and the selection keep their places; a refused sort changes nothing. The stored order is
     * part of the worksheet, so a refresh reads the sorted range back.
     */
    async sortRange(workbookId, worksheetId, payload) {
      const state = await store.read();
      const workbook = findWorkbook(state, workbookId);
      if (!workbook) return null;
      const worksheet = findWorksheet(workbook, worksheetId);
      if (!worksheet) throw new WorkbookError("Unknown worksheet", 404);
      const change = readSortChange(worksheet, payload);
      const before = structuredClone(worksheet);

      const next = await store.update((draft) => {
        const target = findWorkbook(draft, workbookId);
        const sheet = findWorksheet(target, worksheetId);
        if (!sheet) return;
        applySortChange(sheet, change);
        target.updatedAt = nowIso();
      });
      recordChange(workbookId, worksheetId, before, findWorkbook(next, workbookId));
      return normalizeWorkbook(findWorkbook(next, workbookId));
    },

    /** Stores the selected rectangle of one worksheet without touching the workbook timestamp. */
    async updateWorksheetSelection(workbookId, worksheetId, selection) {
      const requested = readSelection(selection);
      if (!requested) throw new WorkbookError("Invalid selection");

      const state = await store.read();
      const workbook = findWorkbook(state, workbookId);
      if (!workbook) return null;
      const worksheet = findWorksheet(workbook, worksheetId);
      if (!worksheet) throw new WorkbookError("Unknown worksheet", 404);

      const next = await store.update((draft) => {
        const target = findWorkbook(draft, workbookId);
        const sheet = findWorksheet(target, worksheetId);
        if (!sheet) return;
        const rowCount = Number.isInteger(sheet.rowCount) ? sheet.rowCount : DEFAULT_ROW_COUNT;
        const columnCount = Number.isInteger(sheet.columnCount) ? sheet.columnCount : DEFAULT_COLUMN_COUNT;
        sheet.selection = {
          anchor: clampAddress(requested.anchor, rowCount, columnCount),
          focus: clampAddress(requested.focus, rowCount, columnCount),
        };
      });
      return normalizeWorkbook(findWorkbook(next, workbookId));
    },

    /** Creates or replaces the validation rule covering exactly the requested rectangle. */
    async saveValidation(workbookId, worksheetId, payload) {
      const rule = normalizeValidationRule(payload, () => makeId("vr"));

      const state = await store.read();
      const workbook = findWorkbook(state, workbookId);
      if (!workbook) return null;
      const worksheet = findWorksheet(workbook, worksheetId);
      if (!worksheet) throw new WorkbookError("Unknown worksheet", 404);

      const next = await store.update((draft) => {
        const target = findWorkbook(draft, workbookId);
        const sheet = findWorksheet(target, worksheetId);
        if (!sheet) return;
        sheet.validations = (Array.isArray(sheet.validations) ? sheet.validations : []).filter(
          (existing) => existing.type !== rule.type || !sameRegion(existing.range, rule.range),
        );
        sheet.validations.push(rule);
      });
      return normalizeWorkbook(findWorkbook(next, workbookId));
    },

    /** Creates or replaces the filter view of one worksheet without touching the workbook timestamp. */
    async saveFilter(workbookId, worksheetId, payload) {
      const filter = normalizeFilter(payload);

      const state = await store.read();
      const workbook = findWorkbook(state, workbookId);
      if (!workbook) return null;
      const worksheet = findWorksheet(workbook, worksheetId);
      if (!worksheet) throw new WorkbookError("Unknown worksheet", 404);

      const next = await store.update((draft) => {
        const target = findWorkbook(draft, workbookId);
        const sheet = findWorksheet(target, worksheetId);
        if (!sheet) return;
        sheet.filter = filter;
      });
      return normalizeWorkbook(findWorkbook(next, workbookId));
    },

    /** Removes the filter view of one worksheet, so every row becomes visible again. */
    async clearFilter(workbookId, worksheetId) {
      const state = await store.read();
      const workbook = findWorkbook(state, workbookId);
      if (!workbook) return null;
      const worksheet = findWorksheet(workbook, worksheetId);
      if (!worksheet) throw new WorkbookError("Unknown worksheet", 404);

      const next = await store.update((draft) => {
        const target = findWorkbook(draft, workbookId);
        const sheet = findWorksheet(target, worksheetId);
        if (!sheet) return;
        sheet.filter = null;
      });
      return normalizeWorkbook(findWorkbook(next, workbookId));
    },

    /** Removes the stored validation rule with this id; the constrained cell values stay. */
    async deleteValidation(workbookId, worksheetId, ruleId) {
      const state = await store.read();
      const workbook = findWorkbook(state, workbookId);
      if (!workbook) return null;
      const worksheet = findWorksheet(workbook, worksheetId);
      if (!worksheet) throw new WorkbookError("Unknown worksheet", 404);

      const next = await store.update((draft) => {
        const target = findWorkbook(draft, workbookId);
        const sheet = findWorksheet(target, worksheetId);
        if (!sheet) return;
        sheet.validations = (Array.isArray(sheet.validations) ? sheet.validations : []).filter(
          (existing) => existing.id !== ruleId,
        );
      });
      return normalizeWorkbook(findWorkbook(next, workbookId));
    },

    /**
     * Creates the result worksheet of one pivot table (REQ-5-3-1): a blank worksheet named with the
     * first unused `PivotN` that reads `sourceWorksheetId`'s selected range. No field is selected
     * yet, so the summary is written when the first `Apply` names the row and value fields.
     */
    async createPivot(workbookId, payload) {
      const state = await store.read();
      const workbook = findWorkbook(state, workbookId);
      if (!workbook) return null;
      const sourceWorksheetId = typeof payload?.sourceWorksheetId === "string" ? payload.sourceWorksheetId : "";
      const source = findWorksheet(workbook, sourceWorksheetId);
      if (!source) throw new WorkbookError("Unknown worksheet", 404);
      const requested = parseRegionRef(payload?.sourceRange);
      if (!requested) throw new WorkbookError("Enter a valid range such as A1:B2");
      if (
        requested.bottom <= requested.top ||
        requested.bottom > source.rowCount ||
        requested.right > source.columnCount ||
        sourceHeaders(source, requested).length === 0
      ) {
        throw new WorkbookError(PIVOT_RANGE_REQUIRED_MESSAGE);
      }

      const next = await store.update((draft) => {
        const target = findWorkbook(draft, workbookId);
        if (!target) return;
        const worksheet = createBlankWorksheet(firstUnusedPivotName(target));
        worksheet.pivot = createPivotConfig(sourceWorksheetId, requested);
        target.worksheets.push(worksheet);
        target.activeWorksheetId = worksheet.id;
        target.updatedAt = nowIso();
      });
      return normalizeWorkbook(findWorkbook(next, workbookId));
    },

    /**
     * Applies one field selection and rewrites the whole summary of a pivot worksheet. The read
     * only ever touches the source worksheet, and a refused configuration leaves the last successful
     * result in place. A `null` payload recomputes the stored configuration ("Refresh pivot table").
     */
    async savePivot(workbookId, worksheetId, payload) {
      const state = await store.read();
      const workbook = findWorkbook(state, workbookId);
      if (!workbook) return null;
      const worksheet = findWorksheet(workbook, worksheetId);
      if (!worksheet) throw new WorkbookError("Unknown worksheet", 404);
      const stored = readStoredPivot(worksheet.pivot);
      if (!stored) throw new WorkbookError(NOT_A_PIVOT_MESSAGE);
      const config = payload === null ? stored : normalizePivotConfig(payload, stored);
      const source = findWorksheet(workbook, stored.sourceWorksheetId);
      if (!source) throw new WorkbookError(INVALID_PIVOT_SOURCE_MESSAGE);
      const result = computePivot(source, config);

      const next = await store.update((draft) => {
        const target = findWorkbook(draft, workbookId);
        const sheet = findWorksheet(target, worksheetId);
        if (!sheet) return;
        sheet.pivot = config;
        sheet.cells = computeWorksheetCells(result.cells);
        sheet.rowCount = Math.max(sheet.rowCount, result.rowCount);
        sheet.columnCount = Math.max(sheet.columnCount, result.columnCount);
        target.updatedAt = nowIso();
      });
      return normalizeWorkbook(findWorkbook(next, workbookId));
    },

    async importCsv(fileName, content) {
      const rows = parseCsv(content);
      const workbook = createImportedWorkbook(workbookNameFromFileName(fileName), rows);
      await store.update((state) => {
        state.workbooks.push(workbook);
      });
      return normalizeWorkbook(workbook);
    },
  };
}

function sameRegion(left, right) {
  return (
    Boolean(left) &&
    Boolean(right) &&
    left.top === right.top &&
    left.bottom === right.bottom &&
    left.left === right.left &&
    left.right === right.right
  );
}

import { INVALID_CSV_MESSAGE, parseCsv, workbookNameFromFileName } from "./csv.mjs";
import {
  addWorksheet,
  applyPivotSettings,
  changeWorksheetColumns,
  changeWorksheetRows,
  clearFilters,
  createBlankWorkbook,
  createFilter,
  createImportedWorkbook,
  createPivotWorksheet,
  deleteValidation,
  deleteWorksheet as removeWorksheet,
  DomainError,
  findWorkbook,
  listWorkbooks,
  normalizeState,
  pasteCells,
  refreshPivot,
  renameWorkbook,
  renameWorksheet,
  requireWorkbook,
  saveValidation,
  setActiveWorksheet,
  setCellValue,
  setColumnFilter,
  setSelection,
  sortWorksheetRange,
  transferWorksheetRange,
  WORKBOOK_NOT_FOUND_MESSAGE,
} from "./workbooks.mjs";

export const NOTHING_TO_UNDO_MESSAGE = "Nothing to undo";
export const NOTHING_TO_REDO_MESSAGE = "Nothing to redo";

/** How many recent operations one workbook keeps for undo/redo. */
const HISTORY_LIMIT = 100;

function presentWorkbook(workbook, { canUndo = false, canRedo = false } = {}) {
  return {
    id: workbook.id,
    name: workbook.name,
    createdAt: workbook.createdAt,
    updatedAt: workbook.updatedAt,
    activeWorksheetId: workbook.activeWorksheetId,
    canUndo,
    canRedo,
    worksheets: workbook.worksheets.map((worksheet) => ({
      id: worksheet.id,
      name: worksheet.name,
      rowCount: worksheet.rowCount,
      columnCount: worksheet.columnCount,
      cells: { ...worksheet.cells },
      selection: { ...worksheet.selection },
      validations: structuredClone(worksheet.validations),
      filters: structuredClone(worksheet.filters),
      pivot: worksheet.pivot ? structuredClone(worksheet.pivot) : null,
    })),
  };
}

/**
 * Workbook service. Content operations (cell edits, pastes, range transfers, row/column structure
 * changes) are recorded as whole-workbook snapshots, so undo/redo can restore grid values, original
 * formulas, row/column structure, rule ranges, pivot ranges and derived results at once. The
 * history lives in this service (the current session) while the *result* of every undo/redo is
 * written through the store, so it survives a page refresh. Each workbook has its own history, so
 * undo never touches another workbook.
 */
export function createWorkbookService(store) {
  const histories = new Map();

  function historyFor(workbookId) {
    let entry = histories.get(workbookId);
    if (!entry) {
      entry = { past: [], future: [] };
      histories.set(workbookId, entry);
    }
    return entry;
  }

  function record(workbookId, snapshot) {
    const entry = historyFor(workbookId);
    entry.past.push(snapshot);
    if (entry.past.length > HISTORY_LIMIT) entry.past.shift();
    // A new modification makes the undone branch unreachable: "Redo" turns unavailable again.
    entry.future = [];
  }

  /** Response body of one workbook: the record plus whether undo/redo are currently possible. */
  function respond(workbook) {
    const entry = histories.get(workbook.id);
    return {
      workbook: presentWorkbook(workbook, {
        canUndo: Boolean(entry?.past.length),
        canRedo: Boolean(entry?.future.length),
      }),
    };
  }

  /**
   * Runs one operation against the stored state. When `historyWorkbookId` is given, the workbook
   * is snapshotted before the mutation and recorded after the write succeeded, so a rejected
   * operation leaves both the state and the history untouched.
   */
  async function mutate(operation, historyWorkbookId) {
    let result = null;
    let snapshot = null;
    await store.update((state) => {
      const normalized = normalizeState(state);
      state.workbooks = normalized.workbooks;
      const target = historyWorkbookId ? findWorkbook(state, historyWorkbookId) : null;
      if (target) snapshot = structuredClone(target);
      result = operation(state);
    });
    if (snapshot) record(historyWorkbookId, snapshot);
    return result;
  }

  /** Replaces one stored workbook with a snapshot and returns both sides of the exchange. */
  async function restoreSnapshot(workbookId, snapshot) {
    let previous = null;
    let restored = null;
    await store.update((state) => {
      const normalized = normalizeState(state);
      state.workbooks = normalized.workbooks;
      const index = state.workbooks.findIndex((item) => item.id === workbookId);
      if (index === -1) throw new DomainError(WORKBOOK_NOT_FOUND_MESSAGE, 404);
      previous = structuredClone(state.workbooks[index]);
      restored = structuredClone(snapshot);
      state.workbooks[index] = restored;
    });
    return { previous, restored };
  }

  return {
    async list() {
      const state = normalizeState(await store.read());
      return { body: { workbooks: listWorkbooks(state) } };
    },

    async get(workbookId) {
      const state = normalizeState(await store.read());
      return { body: respond(requireWorkbook(state, workbookId)) };
    },

    async create(body) {
      const workbook = await mutate((state) => createBlankWorkbook(state, { name: body?.name }));
      return { status: 201, body: respond(workbook) };
    },

    /** Parses the CSV before touching the store so a failure cannot leave a partial workbook. */
    async importCsv(body) {
      if (typeof body?.content !== "string") throw new DomainError(INVALID_CSV_MESSAGE);
      const rows = parseCsv(body.content);
      const name = workbookNameFromFileName(body?.fileName);
      const workbook = await mutate((state) => createImportedWorkbook(state, { name, rows }));
      return { status: 201, body: respond(workbook) };
    },

    async rename(workbookId, body) {
      const workbook = await mutate((state) => renameWorkbook(state, workbookId, { name: body?.name }));
      return { body: respond(workbook) };
    },

    /** `Add worksheet`: a blank tab appended after the existing ones and made active. */
    async addWorksheet(workbookId) {
      const workbook = await mutate((state) => addWorksheet(state, workbookId));
      return { status: 201, body: respond(workbook) };
    },

    /** `Rename` of one worksheet tab; a rejected name leaves the stored name unchanged. */
    async renameWorksheet(workbookId, worksheetId, body) {
      const workbook = await mutate(
        (state) => renameWorksheet(state, workbookId, worksheetId, { name: body?.name }),
      );
      return { body: respond(workbook) };
    },

    /**
     * `Delete` of one worksheet tab: the whole worksheet (and its pivot result) leaves the
     * workbook while its pivot source worksheets stay untouched.
     */
    async deleteWorksheet(workbookId, worksheetId) {
      const workbook = await mutate(
        (state) => removeWorksheet(state, workbookId, worksheetId),
      );
      return { body: respond(workbook) };
    },

    async setCell(workbookId, body) {
      const workbook = await mutate((state) => setCellValue(state, workbookId, {
        worksheetId: body?.worksheetId,
        cell: body?.cell,
        value: body?.value,
      }), workbookId);
      return { body: respond(workbook) };
    },

    /**
     * Whole-rectangle paste of external clipboard text. The rectangle is written in one state
     * update, so a rejected paste leaves every target cell on its previous value.
     */
    async paste(workbookId, body) {
      const workbook = await mutate((state) => pasteCells(state, workbookId, {
        worksheetId: body?.worksheetId,
        start: body?.start,
        text: body?.text,
      }), workbookId);
      return { body: respond(workbook) };
    },

    /** Copy or cut of one rectangular range onto a target location of the same worksheet. */
    async transferRange(workbookId, worksheetId, body) {
      const workbook = await mutate((state) => transferWorksheetRange(state, workbookId, {
        worksheetId,
        source: body?.source,
        target: body?.target,
        mode: body?.mode,
      }), workbookId);
      return { body: respond(workbook) };
    },

    async changeRows(workbookId, worksheetId, body) {
      const workbook = await mutate((state) => changeWorksheetRows(state, workbookId, worksheetId, {
        action: body?.action,
        row: body?.row,
      }), workbookId);
      return { body: respond(workbook) };
    },

    async changeColumns(workbookId, worksheetId, body) {
      const workbook = await mutate((state) => changeWorksheetColumns(state, workbookId, worksheetId, {
        action: body?.action,
        column: body?.column,
      }), workbookId);
      return { body: respond(workbook) };
    },

    /** `Create filter`: one filter view over the region the user selected. */
    async createFilter(workbookId, worksheetId, body) {
      const workbook = await mutate((state) => createFilter(state, workbookId, worksheetId, {
        range: body?.range,
      }), workbookId);
      return { body: respond(workbook) };
    },

    /** `Clear filter`: every source record of the worksheet is visible again. */
    async clearFilter(workbookId, worksheetId) {
      const workbook = await mutate(
        (state) => clearFilters(state, workbookId, worksheetId),
        workbookId,
      );
      return { body: respond(workbook) };
    },

    /** Column condition of an existing filter view (value list or condition operator). */
    async setColumnFilter(workbookId, worksheetId, body) {
      const workbook = await mutate((state) => setColumnFilter(state, workbookId, worksheetId, {
        filterId: body?.filterId,
        column: body?.column,
        condition: body?.condition,
      }), workbookId);
      return { body: respond(workbook) };
    },

    async saveValidation(workbookId, worksheetId, body) {
      const workbook = await mutate((state) => saveValidation(state, workbookId, worksheetId, {
        ruleId: body?.ruleId,
        type: body?.type,
        range: body?.range,
        values: body?.values,
        min: body?.min,
        max: body?.max,
      }), workbookId);
      return { body: respond(workbook) };
    },

    async deleteValidation(workbookId, worksheetId, body) {
      const workbook = await mutate((state) => deleteValidation(state, workbookId, worksheetId, {
        ruleId: body?.ruleId,
      }), workbookId);
      return { body: respond(workbook) };
    },

    /** `Sort range`: re-orders the records of the selected range by one of its columns. */
    async sortRange(workbookId, worksheetId, body) {
      const workbook = await mutate((state) => sortWorksheetRange(state, workbookId, {
        worksheetId,
        range: body?.range,
        column: body?.column,
        order: body?.order,
        hasHeaderRow: body?.hasHeaderRow,
      }), workbookId);
      return { body: respond(workbook) };
    },

    /** `Create pivot table`: a new `PivotN` worksheet holding the default summary of the range. */
    async createPivot(workbookId, worksheetId, body) {
      const workbook = await mutate((state) => createPivotWorksheet(state, workbookId, {
        worksheetId,
        range: body?.range,
      }), workbookId);
      return { status: 201, body: respond(workbook) };
    },

    /** `Apply` of the pivot editor: recomputes the summary from the current source range. */
    async applyPivot(workbookId, worksheetId, body) {
      const settings = {};
      for (const key of ["rows", "columns", "values", "summarizeBy"]) {
        if (body && key in body) settings[key] = body[key];
      }
      const workbook = await mutate(
        (state) => applyPivotSettings(state, workbookId, worksheetId, settings),
        workbookId,
      );
      return { body: respond(workbook) };
    },

    /** `Refresh pivot table`: recomputes the stored configuration, keeping the source untouched. */
    async refreshPivot(workbookId, worksheetId) {
      const workbook = await mutate(
        (state) => refreshPivot(state, workbookId, worksheetId),
        workbookId,
      );
      return { body: respond(workbook) };
    },

    async setActiveWorksheet(workbookId, body) {
      const workbook = await mutate((state) => setActiveWorksheet(state, workbookId, {
        worksheetId: body?.worksheetId,
      }));
      return { body: respond(workbook) };
    },

    async setSelection(workbookId, worksheetId, body) {
      const worksheet = await mutate((state) => setSelection(state, workbookId, worksheetId, {
        anchor: body?.anchor,
        focus: body?.focus,
      }));
      return { body: { worksheetId: worksheet.id, selection: { ...worksheet.selection } } };
    },

    /** Restores the workbook exactly as it was before the most recent recorded operation. */
    async undo(workbookId) {
      requireWorkbook(normalizeState(await store.read()), workbookId);
      const entry = historyFor(workbookId);
      const snapshot = entry.past[entry.past.length - 1];
      if (!snapshot) throw new DomainError(NOTHING_TO_UNDO_MESSAGE);
      const { previous, restored } = await restoreSnapshot(workbookId, snapshot);
      entry.past.pop();
      entry.future.push(previous);
      return { body: respond(restored) };
    },

    /** Reapplies the complete operation that was undone last. */
    async redo(workbookId) {
      requireWorkbook(normalizeState(await store.read()), workbookId);
      const entry = historyFor(workbookId);
      const snapshot = entry.future[entry.future.length - 1];
      if (!snapshot) throw new DomainError(NOTHING_TO_REDO_MESSAGE);
      const { previous, restored } = await restoreSnapshot(workbookId, snapshot);
      entry.future.pop();
      entry.past.push(previous);
      return { body: respond(restored) };
    },
  };
}

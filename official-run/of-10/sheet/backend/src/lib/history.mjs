/**
 * Session scoped undo history of one repository instance (REQ-3-2-2).
 *
 * The log keeps one stack per workbook id, so undoing inside one workbook can never touch another
 * one. A recorded entry holds the two states of one worksheet scoped operation (`{ worksheetId,
 * before, after }`): `before` is written back on undo, `after` on redo. Recording a new operation
 * drops the redo branch, so a change made after an undo disables redo until it is undone again.
 *
 * The history lives in memory only: it belongs to the current server session and may be empty after
 * the process restarts, while every state an undo or redo wrote stays in the store file.
 */

const MAX_ENTRIES_PER_WORKBOOK = 50;

export function createHistoryLog(limitPerWorkbook = MAX_ENTRIES_PER_WORKBOOK) {
  /** @type {Map<string, { undo: Array<object>, redo: Array<object> }>} */
  const logs = new Map();

  function logOf(workbookId) {
    let log = logs.get(workbookId);
    if (!log) {
      log = { undo: [], redo: [] };
      logs.set(workbookId, log);
    }
    return log;
  }

  return {
    /** Keeps one operation of this workbook; the oldest entry falls out once the cap is reached. */
    record(workbookId, entry) {
      const log = logOf(workbookId);
      log.undo.push(entry);
      if (log.undo.length > limitPerWorkbook) log.undo.shift();
      log.redo.length = 0;
    },

    /** Whether this workbook has a change to undo or to redo. */
    state(workbookId) {
      const log = logs.get(workbookId);
      return {
        canUndo: Boolean(log && log.undo.length > 0),
        canRedo: Boolean(log && log.redo.length > 0),
      };
    },

    /** Drops every recorded state of one worksheet, e.g. after that worksheet was deleted. */
    dropWorksheet(workbookId, worksheetId) {
      const log = logs.get(workbookId);
      if (!log) return;
      log.undo = log.undo.filter((entry) => entry.worksheetId !== worksheetId);
      log.redo = log.redo.filter((entry) => entry.worksheetId !== worksheetId);
    },

    /** Moves the most recent operation onto the redo branch and returns it, or null. */
    stepBack(workbookId) {
      const log = logs.get(workbookId);
      if (!log || log.undo.length === 0) return null;
      const entry = log.undo.pop();
      log.redo.push(entry);
      return entry;
    },

    /** Moves the most recently undone operation back onto the undo branch and returns it, or null. */
    stepForward(workbookId) {
      const log = logs.get(workbookId);
      if (!log || log.redo.length === 0) return null;
      const entry = log.redo.pop();
      log.undo.push(entry);
      return entry;
    },
  };
}

/**
 * Undo/redo history for the workbook API.
 *
 * Each recorded entry is a snapshot of the whole workbook as it was before a
 * modification (cell write, range transfer, row/column structure change), so
 * one undo restores grid values, original formulas, structure, rule ranges and
 * the selection together. The stacks live in memory: the restored state is
 * persisted by the caller, while the history itself is per server session.
 * Recording a new modification drops the redo branch, which is what disables
 * `Redo` after a fresh edit.
 */

/** Bounded stack depth so a long editing session cannot grow without limit. */
const MAX_HISTORY_DEPTH = 100;

function clone(value) {
  return structuredClone(value);
}

export function createHistory() {
  /** workbookId -> {undo: snapshots[], redo: snapshots[]} */
  const stacks = new Map();

  function entry(workbookId) {
    let found = stacks.get(workbookId);
    if (!found) {
      found = { undo: [], redo: [] };
      stacks.set(workbookId, found);
    }
    return found;
  }

  return {
    /** Remembers the pre-modification workbook and clears the redo branch. */
    record(workbookId, workbook) {
      const found = entry(workbookId);
      found.undo.push(clone(workbook));
      if (found.undo.length > MAX_HISTORY_DEPTH) found.undo.shift();
      found.redo.length = 0;
    },

    flags(workbookId) {
      const found = stacks.get(workbookId);
      return {
        canUndo: Boolean(found && found.undo.length > 0),
        canRedo: Boolean(found && found.redo.length > 0),
      };
    },

    /** Pops the previous state, remembering `currentWorkbook` for redo. */
    undo(workbookId, currentWorkbook) {
      const found = entry(workbookId);
      if (found.undo.length === 0) return null;
      found.redo.push(clone(currentWorkbook));
      return found.undo.pop();
    },

    /** Pops the state the last undo removed, remembering `currentWorkbook`. */
    redo(workbookId, currentWorkbook) {
      const found = entry(workbookId);
      if (found.redo.length === 0) return null;
      found.undo.push(clone(currentWorkbook));
      return found.redo.pop();
    },
  };
}

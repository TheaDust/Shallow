/**
 * Undo/redo history of the running workbook session (REQ-3-2-2).
 *
 * Every recorded entry is a snapshot of what an operation may change: the raw
 * cell texts, the validation rules and the row filter of each worksheet at the
 * time of the call. Row/column structure lives in the same records, so
 * restoring a snapshot brings back the grid values, the original formulas, the
 * rule ranges, the filter view and the derived calculation results together.
 *
 * The history is intentionally process memory only: it covers the operations of
 * the current session and is empty again after reopening the application, while
 * the state each undo or redo produces is written by the caller through the
 * regular store transaction, so it survives a refresh. Stacks are keyed by
 * workbook id, so undo in one workbook never touches another one.
 */

export const NOTHING_TO_UNDO_MESSAGE = "Nothing to undo";
export const NOTHING_TO_REDO_MESSAGE = "Nothing to redo";

/** How many operations of one workbook remain undoable. */
export const HISTORY_LIMIT = 50;

function cloneCells(cells) {
  return { ...(cells ?? {}) };
}

function cloneRules(rules) {
  return Array.isArray(rules)
    ? rules.map((rule) => ({
      ...rule,
      range: { ...rule.range },
      ...(Array.isArray(rule.values) ? { values: [...rule.values] } : {}),
    }))
    : [];
}

function cloneFilter(filter) {
  if (!filter || typeof filter !== "object") return null;
  const columns = {};
  for (const [key, column] of Object.entries(filter.columns ?? {})) {
    columns[key] = Array.isArray(column?.values) ? { ...column, values: [...column.values] } : { ...column };
  }
  return { range: { ...filter.range }, columns };
}

/** Snapshot of the undoable state of one workbook. */
function capture(workbook) {
  return {
    worksheets: workbook.worksheets.map((worksheet) => ({
      id: worksheet.id,
      cells: cloneCells(worksheet.cells),
      validations: cloneRules(worksheet.validations),
      filter: cloneFilter(worksheet.filter),
    })),
  };
}

/** Writes one snapshot back onto the matching worksheets of the workbook. */
function restore(workbook, entry) {
  for (const stored of entry.worksheets) {
    const worksheet = workbook.worksheets.find((candidate) => candidate.id === stored.id);
    if (!worksheet) continue;
    worksheet.cells = cloneCells(stored.cells);
    worksheet.validations = cloneRules(stored.validations);
    worksheet.filter = cloneFilter(stored.filter);
  }
}

export function createWorkbookHistory({ limit = HISTORY_LIMIT } = {}) {
  const stacks = new Map();

  function stackFor(workbookId) {
    let stack = stacks.get(workbookId);
    if (!stack) {
      stack = { undo: [], redo: [] };
      stacks.set(workbookId, stack);
    }
    return stack;
  }

  return {
    /** Snapshot taken before an operation; pushed only once the write succeeded. */
    capture,
    /** Records a successful operation and drops the redo branch it replaces. */
    push(workbookId, entry) {
      const stack = stackFor(workbookId);
      stack.undo.push(entry);
      if (stack.undo.length > limit) stack.undo.shift();
      stack.redo = [];
    },
    canUndo(workbookId) {
      return stackFor(workbookId).undo.length > 0;
    },
    canRedo(workbookId) {
      return stackFor(workbookId).redo.length > 0;
    },
    /** Restores the state before the last operation; false when there is none. */
    undo(workbook) {
      const stack = stackFor(workbook.id);
      const entry = stack.undo.pop();
      if (!entry) return false;
      stack.redo.push(capture(workbook));
      restore(workbook, entry);
      return true;
    },
    /** Reapplies the operation that was undone last; false when there is none. */
    redo(workbook) {
      const stack = stackFor(workbook.id);
      const entry = stack.redo.pop();
      if (!entry) return false;
      stack.undo.push(capture(workbook));
      restore(workbook, entry);
      return true;
    },
  };
}

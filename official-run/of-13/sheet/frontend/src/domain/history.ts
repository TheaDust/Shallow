/**
 * Undo/redo history of the current workbook session.
 *
 * Every data-changing operation (cell edit, bulk paste, range move, row/column structure
 * change) records the state the affected worksheet had *before* it ran. Undo walks that
 * stack backwards and redo reapplies the undone step; a new modification after an undo
 * clears the redo branch. The history only lives in the session — it is never persisted —
 * while the worksheet state each step restores is written to the server, so the visible
 * result of an undo or redo survives a refresh.
 */

import type { ValidationRule, WorksheetState } from "./workbook";

/** The restore payload of one worksheet: everything an edit can change about it. */
export interface WorksheetSnapshot {
  sheetId: string;
  cells: Record<string, string>;
  /** Absent/undefined means "no stored grid size", restored as `null` (the default). */
  rowCount?: number;
  columnCount?: number;
  validations: ValidationRule[];
}

export interface HistoryState {
  /** States before each recorded operation, oldest first. */
  past: WorksheetSnapshot[];
  /** States after each undone operation, oldest first. */
  future: WorksheetSnapshot[];
}

export const EMPTY_HISTORY: HistoryState = { past: [], future: [] };

export interface HistoryStep {
  snapshot: WorksheetSnapshot;
  history: HistoryState;
}

export function snapshotWorksheet(sheet: WorksheetState): WorksheetSnapshot {
  return {
    sheetId: sheet.id,
    cells: { ...sheet.cells },
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
    validations: (sheet.validations ?? []).map((rule) => ({
      ...rule,
      values: rule.values ? [...rule.values] : undefined,
    })),
  };
}

/** Records one operation that is about to be applied, dropping any redo branch. */
export function recordHistory(history: HistoryState, snapshot: WorksheetSnapshot): HistoryState {
  return { past: [...history.past, snapshot], future: [] };
}

/** Steps back one operation: the state to restore plus the history that results from it. */
export function undoHistory(history: HistoryState, current: WorksheetSnapshot): HistoryStep | null {
  if (history.past.length === 0) return null;
  const snapshot = history.past[history.past.length - 1];
  return {
    snapshot,
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, current],
    },
  };
}

/** Reapplies the operation that was undone last. */
export function redoHistory(history: HistoryState, current: WorksheetSnapshot): HistoryStep | null {
  if (history.future.length === 0) return null;
  const snapshot = history.future[history.future.length - 1];
  return {
    snapshot,
    history: {
      past: [...history.past, current],
      future: history.future.slice(0, -1),
    },
  };
}

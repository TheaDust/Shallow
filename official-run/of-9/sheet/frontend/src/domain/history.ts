import type { CellRecord, FilterView, PivotConfig, ValidationRule, Worksheet } from "./types";

/**
 * A serializable snapshot of one worksheet's domain state. Undo/redo restores
 * these snapshots through the backend so the restored state persists after
 * refresh; the history itself is only kept for the current session.
 */
export interface SheetSnapshot {
  cells: Record<string, CellRecord>;
  validationRules?: ValidationRule[];
  filterViews?: FilterView[];
  pivot?: PivotConfig | null;
}

/** One undoable operation: the sheet state before and after it was applied. */
export interface HistoryEntry {
  sheetId: string;
  before: SheetSnapshot;
  after: SheetSnapshot;
}

interface WorkbookHistory {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

/**
 * Session-scoped undo/redo stacks keyed by workbook id, so undoing in one
 * workbook never touches another workbook. A full page reload clears the
 * registry (history may be empty after reopening); restored states themselves
 * are persisted by the backend.
 */
const historyByWorkbook = new Map<string, WorkbookHistory>();

function stackFor(workbookId: string): WorkbookHistory {
  let stack = historyByWorkbook.get(workbookId);
  if (!stack) {
    stack = { undo: [], redo: [] };
    historyByWorkbook.set(workbookId, stack);
  }
  return stack;
}

function cloneCells(cells: Record<string, CellRecord>): Record<string, CellRecord> {
  const cloned: Record<string, CellRecord> = {};
  for (const [coordinate, cell] of Object.entries(cells)) {
    cloned[coordinate] = { value: cell.value, ...(cell.formula !== undefined ? { formula: cell.formula } : {}) };
  }
  return cloned;
}

/** Captures a worksheet's undoable state (cells, rules, filters, pivot). */
export function snapshotSheet(sheet: Worksheet): SheetSnapshot {
  const snapshot: SheetSnapshot = { cells: cloneCells(sheet.cells ?? {}) };
  if (sheet.validationRules !== undefined) snapshot.validationRules = sheet.validationRules.map((rule) => ({ ...rule }));
  if (sheet.filterViews !== undefined) snapshot.filterViews = sheet.filterViews.map((view) => ({ ...view }));
  if (sheet.pivot !== undefined) snapshot.pivot = sheet.pivot ? { ...sheet.pivot } : sheet.pivot;
  return snapshot;
}

export function pushUndo(workbookId: string, entry: HistoryEntry): void {
  stackFor(workbookId).undo.push(entry);
}

export function popUndo(workbookId: string): HistoryEntry | null {
  return stackFor(workbookId).undo.pop() ?? null;
}

export function pushRedo(workbookId: string, entry: HistoryEntry): void {
  stackFor(workbookId).redo.push(entry);
}

export function popRedo(workbookId: string): HistoryEntry | null {
  return stackFor(workbookId).redo.pop() ?? null;
}

/** A new modification after an undo discards the old redo branch. */
export function clearRedo(workbookId: string): void {
  stackFor(workbookId).redo = [];
}

export function canUndo(workbookId: string): boolean {
  return stackFor(workbookId).undo.length > 0;
}

export function canRedo(workbookId: string): boolean {
  return stackFor(workbookId).redo.length > 0;
}

/** Forgets all history of one workbook (used by tests). */
export function clearHistory(workbookId: string): void {
  historyByWorkbook.delete(workbookId);
}

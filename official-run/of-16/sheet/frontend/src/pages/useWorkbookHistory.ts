import { useCallback, useEffect, useState } from "react";

import { sameSnapshot, snapshotWorksheet, type HistoryEntry, type WorksheetSnapshot } from "../domain/history";
import type { Workbook } from "../domain/workbook";
import { messageOf } from "../lib/api";

export interface WorkbookHistoryDeps {
  workbookId: string;
  /** True while a cell draft is open: Ctrl+Z then undoes the draft's own text. */
  hasOpenDraft(): boolean;
  /** Writes one captured snapshot back (PUT of the worksheet state). */
  restore(worksheetId: string, snapshot: WorksheetSnapshot): Promise<Workbook>;
  /** Applies the restored workbook (the page drops any open cell draft). */
  onRestored(workbook: Workbook): void;
  onError(message: string): void;
}

export interface WorkbookHistoryApi {
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  /** Records one successful mutation; a new entry drops the redo branch. */
  recordHistory(label: string, worksheetId: string, before: WorksheetSnapshot, updated: Workbook): void;
  /** Drops the recorded steps of one worksheet (for example after deleting it). */
  dropWorksheet(worksheetId: string): void;
  undo(): void;
  redo(): void;
}

/**
 * Undo/redo history of one workbook session (REQ-3-2-2).
 *
 * Every successful mutation records the worksheet content *before* and *after*
 * the operation; undo writes the `before` snapshot back, redo the `after` one. A
 * failed restore leaves the history untouched, so Ctrl+Z can be retried, and any
 * new modification drops the redo branch. The history lives in this browser
 * session only: the state it produced is persisted in the worksheet, the stack
 * itself is gone after a reload.
 */
export function useWorkbookHistory({ workbookId, hasOpenDraft, restore, onRestored, onError }: WorkbookHistoryDeps): WorkbookHistoryApi {
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);

  /** Restores one worksheet snapshot; returns false when the write was rejected. */
  const applySnapshot = useCallback(async (entry: HistoryEntry, snapshot: WorksheetSnapshot): Promise<boolean> => {
    try {
      onRestored(await restore(entry.worksheetId, snapshot));
      return true;
    } catch (error) {
      onError(messageOf(error, "Could not restore the previous state."));
      return false;
    }
  }, [restore, onRestored, onError]);

  const undo = useCallback(async () => {
    const entry = undoStack[undoStack.length - 1];
    if (!entry || entry.workbookId !== workbookId) return;
    if (!(await applySnapshot(entry, entry.before))) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, entry]);
  }, [applySnapshot, undoStack, workbookId]);

  const redo = useCallback(async () => {
    const entry = redoStack[redoStack.length - 1];
    if (!entry || entry.workbookId !== workbookId) return;
    if (!(await applySnapshot(entry, entry.after))) return;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, entry]);
  }, [applySnapshot, redoStack, workbookId]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key?.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const target = event.target as HTMLElement | null;
      const inTextControl = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      // An open cell draft undoes its own text first.
      if (inTextControl && hasOpenDraft()) return;
      event.preventDefault();
      if (key === "y" || event.shiftKey) void redo();
      else void undo();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [undo, redo, hasOpenDraft]);

  return {
    undoStack,
    redoStack,
    recordHistory: (label, worksheetId, before, updated) => {
      const target = updated.worksheets.find((candidate) => candidate.id === worksheetId);
      if (!target) return;
      const after = snapshotWorksheet(target);
      if (sameSnapshot(before, after)) return;
      setUndoStack((stack) => [...stack, { workbookId, worksheetId, label, before, after }]);
      setRedoStack([]);
    },
    dropWorksheet: (worksheetId) => {
      // A removed worksheet cannot be restored by a snapshot write anymore, so
      // its recorded steps leave the stack together with the tab.
      setUndoStack((stack) => stack.filter((entry) => entry.worksheetId !== worksheetId));
      setRedoStack((stack) => stack.filter((entry) => entry.worksheetId !== worksheetId));
    },
    undo: () => { void undo(); },
    redo: () => { void redo(); },
  };
}

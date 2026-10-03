import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { ApiError } from "../lib/api";
import { restoreWorksheet } from "../domain/workbook-api";
import type { Workbook, WorksheetSnapshot } from "../domain/types";

/** One reversible operation: the worksheet state just before and just after it succeeded. */
export interface HistoryEntry {
  worksheetId: string;
  before: WorksheetSnapshot;
  after: WorksheetSnapshot;
}

export const HISTORY_ERROR = "Unable to restore the previous state. Please try again.";

export interface WorkbookHistory {
  canUndo: boolean;
  canRedo: boolean;
  pending: boolean;
  error: string;
  /** Records one successful operation so Undo/Redo can restore either side of it. */
  record(worksheetId: string, before: WorksheetSnapshot, after: WorksheetSnapshot): void;
  undo(): void;
  redo(): void;
}

export interface WorkbookHistoryOptions {
  workbook: Workbook | null;
  setWorkbook: Dispatch<SetStateAction<Workbook | null>>;
}

function messageOf(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : HISTORY_ERROR;
}

/**
 * Session-scoped undo/redo history for the open workbook. Stacks live in refs and a
 * version counter drives re-renders, so a new modification after an undo drops the
 * redo branch. Each step persists through `restoreWorksheet`, so the restored state
 * survives a refresh; the history itself may be empty after reopening.
 */
export function useWorkbookHistory({ workbook, setWorkbook }: WorkbookHistoryOptions): WorkbookHistory {
  const undoRef = useRef<HistoryEntry[]>([]);
  const redoRef = useRef<HistoryEntry[]>([]);
  const workbookRef = useRef<Workbook | null>(workbook);
  workbookRef.current = workbook;
  const busyRef = useRef(false);
  const [, setVersion] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const record = useCallback((worksheetId: string, before: WorksheetSnapshot, after: WorksheetSnapshot) => {
    undoRef.current = [...undoRef.current, { worksheetId, before, after }];
    redoRef.current = [];
    setVersion((value) => value + 1);
  }, []);

  const step = useCallback(async (direction: "undo" | "redo") => {
    if (busyRef.current) return;
    const current = workbookRef.current;
    if (!current) return;
    const source = direction === "undo" ? undoRef.current : redoRef.current;
    const entry = source[source.length - 1];
    if (!entry) return;
    busyRef.current = true;
    setPending(true);
    setError("");
    try {
      const snapshot = direction === "undo" ? entry.before : entry.after;
      const updated = await restoreWorksheet(current.id, entry.worksheetId, snapshot);
      setWorkbook(updated);
      if (direction === "undo") {
        undoRef.current = undoRef.current.slice(0, -1);
        redoRef.current = [...redoRef.current, entry];
      } else {
        redoRef.current = redoRef.current.slice(0, -1);
        undoRef.current = [...undoRef.current, entry];
      }
      setVersion((value) => value + 1);
    } catch (cause) {
      // A rejected restore keeps the current stored state; the stacks are untouched.
      setError(messageOf(cause));
    } finally {
      busyRef.current = false;
      setPending(false);
    }
  }, [setWorkbook]);

  return {
    canUndo: undoRef.current.length > 0,
    canRedo: redoRef.current.length > 0,
    pending,
    error,
    record,
    undo: () => void step("undo"),
    redo: () => void step("redo"),
  };
}

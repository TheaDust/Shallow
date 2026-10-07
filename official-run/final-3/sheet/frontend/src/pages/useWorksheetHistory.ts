import { useCallback, useEffect, useRef, useState } from "react";

import type { ValidationRule, Worksheet } from "../domain/types";

/**
 * Everything undo/redo restores for one worksheet: its grid values (original
 * formulas included), the validation rules covering its ranges and, because row
 * and column structure changes are stored as a shifted cell map, the structure
 * itself. Pivot results are derived from these values, so restoring the cells
 * restores their validity too.
 */
export interface WorksheetSnapshot {
  worksheetId: string;
  cells: Record<string, string>;
  validationRules?: ValidationRule[];
}

export function snapshotWorksheet(worksheet: Worksheet): WorksheetSnapshot {
  return {
    worksheetId: worksheet.id,
    cells: { ...worksheet.cells },
    validationRules: worksheet.validationRules ? [...worksheet.validationRules] : undefined,
  };
}

type StackKind = "undo" | "redo";

interface PendingRestore {
  kind: StackKind;
  target: WorksheetSnapshot;
  /** The post-operation state moved onto the opposite stack. */
  pushed: WorksheetSnapshot;
}

export interface WorksheetHistory {
  canUndo: boolean;
  canRedo: boolean;
  /** Stores the pre-operation state and drops the redo branch. */
  record(snapshot: WorksheetSnapshot): void;
  /** Pops the newest undo entry, moving the current state onto the redo stack. */
  takeUndo(currentFor: (worksheetId: string) => WorksheetSnapshot): WorksheetSnapshot | null;
  /** Pops the newest redo entry, moving the current state onto the undo stack. */
  takeRedo(currentFor: (worksheetId: string) => WorksheetSnapshot): WorksheetSnapshot | null;
  /** Puts both stacks back after a restore failed, so nothing is lost. */
  restoreFailed(): void;
}

/**
 * Session-scoped undo/redo stacks of worksheet snapshots. The stacks live in
 * memory only (so reopening the workbook starts empty) while every restored
 * snapshot is persisted by the caller, which is why the visible state after an
 * undo or redo survives a refresh. `resetKey` (the workbook id) clears the
 * stacks when another workbook is opened, so undo never touches a second
 * workbook.
 */
export function useWorksheetHistory(resetKey: string): WorksheetHistory {
  const stateRef = useRef<{ past: WorksheetSnapshot[]; future: WorksheetSnapshot[]; pending: PendingRestore | null }>({
    past: [],
    future: [],
    pending: null,
  });
  const [counts, setCounts] = useState({ past: 0, future: 0 });

  const sync = useCallback(() => {
    setCounts({ past: stateRef.current.past.length, future: stateRef.current.future.length });
  }, []);

  useEffect(() => {
    stateRef.current = { past: [], future: [], pending: null };
    setCounts({ past: 0, future: 0 });
  }, [resetKey]);

  const record = useCallback(
    (snapshot: WorksheetSnapshot) => {
      const state = stateRef.current;
      state.past.push(snapshot);
      state.future = [];
      state.pending = null;
      sync();
    },
    [sync],
  );

  const takeUndo = useCallback(
    (currentFor: (worksheetId: string) => WorksheetSnapshot) => {
      const state = stateRef.current;
      const target = state.past[state.past.length - 1];
      if (!target) return null;
      state.past.pop();
      const pushed = currentFor(target.worksheetId);
      state.future.push(pushed);
      state.pending = { kind: "undo", target, pushed };
      sync();
      return target;
    },
    [sync],
  );

  const takeRedo = useCallback(
    (currentFor: (worksheetId: string) => WorksheetSnapshot) => {
      const state = stateRef.current;
      const target = state.future[state.future.length - 1];
      if (!target) return null;
      state.future.pop();
      const pushed = currentFor(target.worksheetId);
      state.past.push(pushed);
      state.pending = { kind: "redo", target, pushed };
      sync();
      return target;
    },
    [sync],
  );

  const restoreFailed = useCallback(() => {
    const state = stateRef.current;
    const pending = state.pending;
    state.pending = null;
    if (!pending) return;
    if (pending.kind === "undo") {
      state.future.pop();
      state.past.push(pending.target);
    } else {
      state.past.pop();
      state.future.push(pending.target);
    }
    sync();
  }, [sync]);

  return {
    canUndo: counts.past > 0,
    canRedo: counts.future > 0,
    record,
    takeUndo,
    takeRedo,
    restoreFailed,
  };
}

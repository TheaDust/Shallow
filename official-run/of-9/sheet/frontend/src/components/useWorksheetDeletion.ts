import { useCallback, useState } from "react";

import { singleCellSelection, type GridSelection } from "../domain/grid";
import type { Workbook, Worksheet } from "../domain/types";
import { deleteSheet } from "../lib/api";

export interface WorksheetDeletionOptions {
  getWorkbook(): Workbook | null;
  busy: boolean;
  setBusy(busy: boolean): void;
  setError(error: string | null): void;
  setWorkbook(workbook: Workbook): void;
  sheetSelectionsRef: { current: Record<string, GridSelection> };
  setSelection(selection: GridSelection): void;
  resetFormulaDraft(): void;
}

/**
 * Orchestrates the worksheet tab menu's Delete command: guards the last
 * worksheet without opening a dialog, opens a confirmation dialog for the
 * target, and applies or fails the deletion. On success the target is removed
 * and an adjacent sheet becomes active; on any rejection the dialog closes,
 * the page alert shows the message, and the workbook stays unchanged.
 */
export function useWorksheetDeletion(options: WorksheetDeletionOptions) {
  const {
    getWorkbook,
    busy,
    setBusy,
    setError,
    setWorkbook,
    sheetSelectionsRef,
    setSelection,
    resetFormulaDraft,
  } = options;
  const [target, setTarget] = useState<Worksheet | null>(null);

  const handleDelete = useCallback(
    (sheet: Worksheet) => {
      const wb = getWorkbook();
      if (!wb) return;
      if (wb.sheets.length <= 1) {
        setError("A workbook must contain at least one worksheet");
        return;
      }
      setError(null);
      setTarget(sheet);
    },
    [getWorkbook, setError],
  );

  const handleConfirm = useCallback(async () => {
    if (!target || busy) return;
    const wb = getWorkbook();
    if (!wb) return;
    const wasActive = wb.activeSheetId === target.id;
    setBusy(true);
    setError(null);
    try {
      const updated = await deleteSheet(wb.id, target.id);
      delete sheetSelectionsRef.current[target.id];
      setWorkbook(updated);
      setTarget(null);
      if (wasActive) {
        const active = updated.sheets.find((sheet) => sheet.id === updated.activeSheetId) ?? updated.sheets[0];
        const next = sheetSelectionsRef.current[active.id] ?? singleCellSelection(1, 1);
        sheetSelectionsRef.current[active.id] = next;
        setSelection(next);
        resetFormulaDraft();
      }
    } catch (caught) {
      // The workbook was not modified; close the dialog and surface the
      // rejection (e.g. a dependent pivot table) in the page alert. The
      // target tab and grid remain visible.
      setTarget(null);
      setError(caught instanceof Error ? caught.message : "Failed to delete worksheet");
    } finally {
      setBusy(false);
    }
  }, [target, busy, getWorkbook, setBusy, setError, setWorkbook, sheetSelectionsRef, setSelection, resetFormulaDraft]);

  return { target, setTarget, handleDelete, handleConfirm };
}

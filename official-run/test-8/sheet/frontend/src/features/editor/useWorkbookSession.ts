import { useCallback, useEffect, useRef, useState } from "react";

import type {
  CellCoordinate,
  CellRange,
  CellSelection,
  HistoryState,
  PivotSummarizeMethod,
  RangeTransferMode,
  SortRangeSpec,
  ValidationRuleInput,
  Workbook,
  Worksheet,
  WorksheetFilter,
  WorksheetStructureOperation,
} from "../../domain/types";
import {
  applyPivotTable as applyPivotTableRequest,
  applyStructureOperation,
  createPivotTable as createPivotTableRequest,
  createWorksheet,
  deleteValidationRule as deleteValidationRuleRequest,
  deleteWorksheet as deleteWorksheetRequest,
  errorMessage,
  fetchWorkbook,
  refreshPivotTable as refreshPivotTableRequest,
  renameWorkbook,
  renameWorksheet as renameWorksheetRequest,
  saveValidationRule as saveValidationRuleRequest,
  saveWorksheetFilter,
  saveWorksheetSelection,
  setActiveWorksheet,
  sortWorksheetRange,
  stepWorkbookHistory,
  transferWorksheetRange,
  writeWorksheetCells,
  type WorkbookSessionPayload,
} from "../../lib/workbooks-api";

export type SessionStatus = "loading" | "ready" | "error";

const NO_HISTORY: HistoryState = { canUndo: false, canRedo: false };

function withWorksheet(workbook: Workbook, worksheet: Worksheet): Workbook {
  return {
    ...workbook,
    worksheets: workbook.worksheets.map((entry) => (entry.id === worksheet.id ? worksheet : entry)),
  };
}

/**
 * Owns the currently opened workbook: loads it by id, exposes the trusted
 * mutations (rename, tab switch, selection, cell writes, range transfers and
 * undo/redo) and keeps the local copy in sync with the persisted server state.
 *
 * Every mutation runs through one promise queue so a cell write and the
 * selection change triggered by the same user action reach the store in the
 * order they happened and never interleave. `history` mirrors the server's
 * undo/redo availability, which the toolbar buttons read.
 */
export function useWorkbookSession(workbookId: string) {
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [history, setHistory] = useState<HistoryState>(NO_HISTORY);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = queueRef.current.then(task, task);
    queueRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  /** Applies a mutation response: the stored workbook plus its history flags. */
  const apply = useCallback((payload: WorkbookSessionPayload) => {
    setWorkbook(payload.workbook);
    // Routes that do not touch the history leave the current flags in place.
    if (payload.history) setHistory(payload.history);
    return payload.workbook;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);
    setWorkbook(null);
    setHistory(NO_HISTORY);
    fetchWorkbook(workbookId)
      .then((payload) => {
        if (cancelled) return;
        apply(payload);
        setStatus("ready");
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(errorMessage(cause));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [apply, workbookId]);

  const rename = useCallback(
    (name: string) =>
      enqueue(async () => apply(await renameWorkbook(workbookId, name))),
    [apply, enqueue, workbookId],
  );

  const activateWorksheet = useCallback(
    (worksheetId: string) =>
      enqueue(async () => apply(await setActiveWorksheet(workbookId, worksheetId))),
    [apply, enqueue, workbookId],
  );

  const addWorksheet = useCallback(
    () => enqueue(async () => apply(await createWorksheet(workbookId))),
    [apply, enqueue, workbookId],
  );

  const renameWorksheet = useCallback(
    (worksheetId: string, name: string) =>
      enqueue(async () => apply(await renameWorksheetRequest(workbookId, worksheetId, name))),
    [apply, enqueue, workbookId],
  );

  /**
   * Deletes one worksheet; the response carries the remaining tabs and the
   * adjacent worksheet the store made active. A rejected deletion leaves the
   * stored workbook untouched and rejects this promise too.
   */
  const deleteWorksheet = useCallback(
    (worksheetId: string) =>
      enqueue(async () => apply(await deleteWorksheetRequest(workbookId, worksheetId))),
    [apply, enqueue, workbookId],
  );

  /** Persists a rectangular selection; the whole rectangle is stored, not just A1. */
  const selectRange = useCallback(
    (worksheetId: string, selection: CellSelection) =>
      enqueue(async () => {
        const worksheet = await saveWorksheetSelection(workbookId, worksheetId, selection);
        setWorkbook((current) => (current ? withWorksheet(current, worksheet) : current));
        return worksheet;
      }),
    [enqueue, workbookId],
  );

  /**
   * Writes a rectangle of raw text starting at `start`. The server applies the
   * whole rectangle or rejects it, and the returned workbook replaces the local
   * copy so the grid always mirrors the persisted state.
   */
  const writeCells = useCallback(
    (worksheetId: string, start: CellCoordinate, values: string[][]) =>
      enqueue(async () => apply(await writeWorksheetCells(workbookId, worksheetId, start, values))),
    [apply, enqueue, workbookId],
  );

  /** Copies or cuts a rectangle and pastes it at `target` in the same worksheet. */
  const transferRange = useCallback(
    (
      worksheetId: string,
      source: CellSelection,
      target: CellCoordinate,
      mode: RangeTransferMode,
    ) =>
      enqueue(async () =>
        apply(await transferWorksheetRange(workbookId, worksheetId, source, target, mode)),
      ),
    [apply, enqueue, workbookId],
  );

  /**
   * Reorders the records of one rectangular range by one of its columns; the
   * server applies the whole sort or rejects it without moving a record.
   */
  const sortRange = useCallback(
    (worksheetId: string, spec: SortRangeSpec) =>
      enqueue(async () => apply(await sortWorksheetRange(workbookId, worksheetId, spec))),
    [apply, enqueue, workbookId],
  );

  /** Replaces (or clears, with `null`) the row filter of the active worksheet. */
  const setFilter = useCallback(
    (worksheetId: string, filter: WorksheetFilter | null) =>
      enqueue(async () =>
        apply(await saveWorksheetFilter(workbookId, worksheetId, filter)),
      ),
    [apply, enqueue, workbookId],
  );

  /** Saves one data-validation rule for the worksheet. */
  const saveValidation = useCallback(
    (worksheetId: string, rule: ValidationRuleInput) =>
      enqueue(async () =>
        apply(await saveValidationRuleRequest(workbookId, worksheetId, rule)),
      ),
    [apply, enqueue, workbookId],
  );

  /** Removes one data-validation rule, dropping its constraint at once. */
  const deleteValidation = useCallback(
    (worksheetId: string, ruleId: string) =>
      enqueue(async () =>
        apply(await deleteValidationRuleRequest(workbookId, worksheetId, ruleId)),
      ),
    [apply, enqueue, workbookId],
  );

  const structureOperation = useCallback(
    (worksheetId: string, operation: WorksheetStructureOperation, index: number) =>
      enqueue(async () => apply(await applyStructureOperation(workbookId, worksheetId, operation, index))),
    [apply, enqueue, workbookId],
  );

  /** Steps the workbook's session history back or forward. */
  const stepHistory = useCallback(
    (action: "undo" | "redo") => enqueue(async () => apply(await stepWorkbookHistory(workbookId, action))),
    [apply, enqueue, workbookId],
  );

  /** Creates a pivot result worksheet over a source range of the active worksheet. */
  const createPivot = useCallback(
    (sourceWorksheetId: string, range: CellRange) =>
      enqueue(async () =>
        apply(await createPivotTableRequest(workbookId, sourceWorksheetId, range)),
      ),
    [apply, enqueue, workbookId],
  );

  /** Applies one pivot field selection and recomputes its result worksheet. */
  const applyPivot = useCallback(
    (
      pivotId: string,
      selection: {
        rowField: string;
        columnField: string | null;
        valueField: string;
        summarizeBy: PivotSummarizeMethod;
      },
    ) =>
      enqueue(async () =>
        apply(await applyPivotTableRequest(workbookId, pivotId, selection)),
      ),
    [apply, enqueue, workbookId],
  );

  /** Rebuilds a pivot result from the current source range. */
  const refreshPivot = useCallback(
    (pivotId: string) =>
      enqueue(async () => apply(await refreshPivotTableRequest(workbookId, pivotId))),
    [apply, enqueue, workbookId],
  );

  const undo = useCallback(() => stepHistory("undo"), [stepHistory]);
  const redo = useCallback(() => stepHistory("redo"), [stepHistory]);

  return {
    status,
    workbook,
    history,
    error,
    rename,
    activateWorksheet,
    addWorksheet,
    renameWorksheet,
    deleteWorksheet,
    selectRange,
    writeCells,
    transferRange,
    structureOperation,
    sortRange,
    setFilter,
    saveValidation,
    deleteValidation,
    createPivot,
    applyPivot,
    refreshPivot,
    undo,
    redo,
  };
}

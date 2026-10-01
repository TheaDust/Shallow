import { useCallback, useEffect, useRef, useState } from "react";

import { apiErrorMessage } from "../lib/api";
import { cellCoordinate, parseCellCoordinate, type SelectionRange } from "../lib/spreadsheet";
import {
  addWorksheet as requestAddWorksheet,
  applyPivotSettings,
  changeWorksheetColumns,
  changeWorksheetRows,
  clearFilterView,
  createFilterView,
  createPivotTable,
  deleteValidationRule,
  deleteWorksheet as requestDeleteWorksheet,
  fetchWorkbook,
  pasteCells,
  redoWorkbook,
  refreshPivotTable,
  renameWorkbook,
  renameWorksheet as requestRenameWorksheet,
  saveActiveWorksheet,
  saveCellValue,
  saveColumnFilter,
  saveSelection,
  saveValidationRule,
  sortRange as requestRangeSort,
  transferRange as requestRangeTransfer,
  undoWorkbook,
  type CellRange,
  type ColumnCondition,
  type ColumnStructureAction,
  type PivotSettings,
  type RangeTransferMode,
  type RowStructureAction,
  type SortOrder,
  type Workbook,
  type Worksheet,
} from "../lib/workbooks";

export type WorkbookStatus = "loading" | "ready" | "error";

export interface WorkbookController {
  status: WorkbookStatus;
  workbook: Workbook | null;
  loadError: string | null;
  actionError: string | null;
  /** Message of the most recent failed pivot operation; the pivot editor shows it beside its fields. */
  pivotError: string | null;
  busy: boolean;
  /** Undo/redo availability reported by the server for this workbook session. */
  canUndo: boolean;
  canRedo: boolean;
  reload(): void;
  dismissActionError(): void;
  /** Surfaces a client-side failure (for example an unreadable clipboard) through the same banner. */
  reportActionError(message: string): void;
  rename(name: string): Promise<boolean>;
  commitCell(worksheetId: string, cell: string, value: string): Promise<boolean>;
  paste(worksheetId: string, start: string, text: string): Promise<boolean>;
  transferRange(
    worksheetId: string,
    source: CellRange,
    target: CellRange,
    mode: RangeTransferMode,
  ): Promise<boolean>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  changeRows(worksheetId: string, action: RowStructureAction, row: number): Promise<boolean>;
  changeColumns(worksheetId: string, action: ColumnStructureAction, column: string): Promise<boolean>;
  activateWorksheet(worksheetId: string): Promise<boolean>;
  /** `Add worksheet`: the server answers with the new tab (already active, A1 selected). */
  addWorksheet(): Promise<boolean>;
  /** `Rename` of one worksheet tab; a rejected name keeps the previous one. */
  renameWorksheet(worksheetId: string, name: string): Promise<boolean>;
  /**
   * `Delete` of one worksheet tab; a refusal (a pivot still reading the worksheet, the last
   * worksheet, a write failure) keeps every tab and reports the message on the error banner.
   */
  deleteWorksheet(worksheetId: string): Promise<boolean>;
  selectCell(worksheetId: string, selection: SelectionRange): Promise<void>;
  createFilter(worksheetId: string, range: CellRange): Promise<boolean>;
  clearFilter(worksheetId: string): Promise<boolean>;
  /** `Sort range`: re-orders the records of the selected range by one of its columns. */
  sortRange(
    worksheetId: string,
    payload: { range: CellRange; column: string; order: SortOrder; hasHeaderRow: boolean },
  ): Promise<boolean>;
  setColumnFilter(
    worksheetId: string,
    filterId: string,
    column: string,
    condition: ColumnCondition | null,
  ): Promise<boolean>;
  saveValidation(
    worksheetId: string,
    payload: {
      ruleId?: string;
      type: string;
      range: CellRange;
      values?: string;
      min?: string;
      max?: string;
    },
  ): Promise<boolean>;
  deleteValidation(worksheetId: string, ruleId: string): Promise<boolean>;
  /** `Create pivot table`: a new `PivotN` worksheet holding the default summary of `range`. */
  createPivot(worksheetId: string, range: CellRange): Promise<boolean>;
  /** `Apply` of the pivot editor: recomputes the summary from the current source range. */
  applyPivot(worksheetId: string, settings: PivotSettings): Promise<boolean>;
  /** `Refresh pivot table`: recomputes the stored configuration, keeping the last result on failure. */
  refreshPivot(worksheetId: string): Promise<boolean>;
  clearPivotError(): void;
}

export function errorMessage(error: unknown): string {
  return apiErrorMessage(error);
}

/** Keeps a coordinate inside the grid that just replaced the previous state (undo/redo). */
function clampCoordinate(coordinate: string, worksheet: Worksheet): string {
  const position = parseCellCoordinate(coordinate);
  if (!position) return "A1";
  return cellCoordinate(
    Math.min(position.row, worksheet.rowCount - 1),
    Math.min(position.column, worksheet.columnCount - 1),
  );
}

function clampSelection(selection: SelectionRange, worksheet: Worksheet): SelectionRange {
  const anchor = clampCoordinate(selection.anchor, worksheet);
  const focus = clampCoordinate(selection.focus, worksheet);
  return anchor === selection.anchor && focus === selection.focus ? selection : { anchor, focus };
}

/**
 * Cell mutations come back from the server; the rectangular selection is owned by the client and
 * persisted through its own endpoint, so keep the local (newest) selection instead of the response.
 */
function mergeSelections(next: Workbook, current: Workbook | null): Workbook {
  if (!current) return next;
  return {
    ...next,
    worksheets: next.worksheets.map((worksheet) => {
      const local = current.worksheets.find((item) => item.id === worksheet.id);
      return local ? { ...worksheet, selection: clampSelection(local.selection, worksheet) } : worksheet;
    }),
  };
}

export function useWorkbook(workbookId: string): WorkbookController {
  const [status, setStatus] = useState<WorkbookStatus>("loading");
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pivotError, setPivotError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const workbookRef = useRef<Workbook | null>(null);
  const busyRef = useRef(false);

  const apply = useCallback((next: Workbook | null) => {
    workbookRef.current = next;
    setWorkbook(next);
  }, []);

  const load = useCallback(async () => {
    setStatus("loading");
    setLoadError(null);
    try {
      const next = await fetchWorkbook(workbookId);
      apply(next);
      setStatus("ready");
    } catch (error) {
      apply(null);
      setLoadError(errorMessage(error));
      setStatus("error");
    }
  }, [apply, workbookId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(async (operation: () => Promise<Workbook>): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      const next = await operation();
      apply(next);
      setActionError(null);
      return true;
    } catch (error) {
      setActionError(errorMessage(error));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [apply]);

  const rename = useCallback(
    (name: string) => run(() => renameWorkbook(workbookId, name)),
    [run, workbookId],
  );

  const commitCell = useCallback(
    (worksheetId: string, cell: string, value: string) =>
      run(async () => mergeSelections(
        await saveCellValue(workbookId, worksheetId, cell, value),
        workbookRef.current,
      )),
    [run, workbookId],
  );

  const activateWorksheet = useCallback(
    (worksheetId: string) => run(() => saveActiveWorksheet(workbookId, worksheetId)),
    [run, workbookId],
  );

  /**
   * The server answers with the tab order, the new active worksheet and its blank A1 state, so the
   * response replaces the local state (like switching tabs does).
   */
  const addWorksheet = useCallback(
    () => run(() => requestAddWorksheet(workbookId)),
    [run, workbookId],
  );

  const renameWorksheet = useCallback(
    (worksheetId: string, name: string) => run(async () => mergeSelections(
      await requestRenameWorksheet(workbookId, worksheetId, name),
      workbookRef.current,
    )),
    [run, workbookId],
  );

  /**
   * The server answers with the remaining tab order and the worksheet that became active, so the
   * response replaces the local state instead of merging it.
   */
  const deleteWorksheet = useCallback(
    (worksheetId: string) => run(() => requestDeleteWorksheet(workbookId, worksheetId)),
    [run, workbookId],
  );

  /**
   * A paste rewrites cells only, so the local (newest) rectangular selection is kept, exactly like
   * a single-cell commit.
   */
  const paste = useCallback(
    (worksheetId: string, start: string, text: string) =>
      run(async () => mergeSelections(
        await pasteCells(workbookId, worksheetId, start, text),
        workbookRef.current,
      )),
    [run, workbookId],
  );

  /**
   * Structure changes, range transfers, undo and redo return the re-mapped worksheet, including the
   * adjusted selection and the new undo/redo availability, so the server response replaces the local
   * state instead of merging it.
   */
  const changeRows = useCallback(
    (worksheetId: string, action: RowStructureAction, row: number) =>
      run(() => changeWorksheetRows(workbookId, worksheetId, { action, row })),
    [run, workbookId],
  );

  const changeColumns = useCallback(
    (worksheetId: string, action: ColumnStructureAction, column: string) =>
      run(() => changeWorksheetColumns(workbookId, worksheetId, { action, column })),
    [run, workbookId],
  );

  /**
   * A range transfer rewrites cells only, so the local (newest) rectangular selection is kept, the
   * same way a single-cell commit or a paste behaves.
   */
  const transferRange = useCallback(
    (worksheetId: string, source: CellRange, target: CellRange, mode: RangeTransferMode) =>
      run(async () => mergeSelections(
        await requestRangeTransfer(workbookId, worksheetId, { source, target, mode }),
        workbookRef.current,
      )),
    [run, workbookId],
  );

  const undo = useCallback(
    () => run(async () => mergeSelections(await undoWorkbook(workbookId), workbookRef.current)),
    [run, workbookId],
  );

  const redo = useCallback(
    () => run(async () => mergeSelections(await redoWorkbook(workbookId), workbookRef.current)),
    [run, workbookId],
  );

  const selectCell = useCallback(async (worksheetId: string, selection: SelectionRange) => {
    const current = workbookRef.current;
    if (!current) return;
    apply({
      ...current,
      worksheets: current.worksheets.map((worksheet) =>
        worksheet.id === worksheetId ? { ...worksheet, selection } : worksheet),
    });
    try {
      await saveSelection(workbookId, worksheetId, selection);
      setActionError(null);
    } catch (error) {
      apply(current);
      setActionError(errorMessage(error));
    }
  }, [apply, workbookId]);

  /** `Create filter` over a region; `Clear filter` removes the worksheet's filter view again. */
  const createFilter = useCallback(
    (worksheetId: string, range: CellRange) =>
      run(async () => mergeSelections(
        await createFilterView(workbookId, worksheetId, range),
        workbookRef.current,
      )),
    [run, workbookId],
  );

  const clearFilter = useCallback(
    (worksheetId: string) =>
      run(async () => mergeSelections(
        await clearFilterView(workbookId, worksheetId),
        workbookRef.current,
      )),
    [run, workbookId],
  );

  /**
   * Sorting moves whole records inside the selected range, so the local (newest) selection is kept
   * exactly like after a paste.
   */
  const sortRange = useCallback(
    (worksheetId: string, payload: { range: CellRange; column: string; order: SortOrder; hasHeaderRow: boolean }) =>
      run(async () => mergeSelections(
        await requestRangeSort(workbookId, worksheetId, payload),
        workbookRef.current,
      )),
    [run, workbookId],
  );

  /** A column condition hides rows only, so the local selection is kept like after a paste. */
  const setColumnFilter = useCallback(
    (worksheetId: string, filterId: string, column: string, condition: ColumnCondition | null) =>
      run(async () => mergeSelections(
        await saveColumnFilter(workbookId, worksheetId, filterId, column, condition),
        workbookRef.current,
      )),
    [run, workbookId],
  );

  const saveValidation = useCallback(
    (worksheetId: string, payload: Parameters<WorkbookController["saveValidation"]>[1]) =>
      run(async () => mergeSelections(
        await saveValidationRule(workbookId, worksheetId, payload),
        workbookRef.current,
      )),
    [run, workbookId],
  );

  const deleteValidation = useCallback(
    (worksheetId: string, ruleId: string) =>
      run(async () => mergeSelections(
        await deleteValidationRule(workbookId, worksheetId, ruleId),
        workbookRef.current,
      )),
    [run, workbookId],
  );

  /**
   * Pivot operations report through their own channel: the pivot editor shows the message beside
   * its fields instead of the editor-wide banner, so a refusal is visible exactly once.
   */
  const runPivot = useCallback(async (operation: () => Promise<Workbook>): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      const next = await operation();
      apply(next);
      setPivotError(null);
      return true;
    } catch (error) {
      setPivotError(errorMessage(error));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [apply]);

  const createPivot = useCallback(
    (worksheetId: string, range: CellRange) =>
      runPivot(() => createPivotTable(workbookId, worksheetId, range)),
    [runPivot, workbookId],
  );

  const applyPivot = useCallback(
    (worksheetId: string, settings: PivotSettings) =>
      runPivot(async () => mergeSelections(
        await applyPivotSettings(workbookId, worksheetId, settings),
        workbookRef.current,
      )),
    [runPivot, workbookId],
  );

  const refreshPivot = useCallback(
    (worksheetId: string) =>
      runPivot(async () => mergeSelections(
        await refreshPivotTable(workbookId, worksheetId),
        workbookRef.current,
      )),
    [runPivot, workbookId],
  );

  return {
    status,
    workbook,
    loadError,
    actionError,
    pivotError,
    busy,
    canUndo: Boolean(workbook?.canUndo),
    canRedo: Boolean(workbook?.canRedo),
    reload: () => {
      void load();
    },
    dismissActionError: () => setActionError(null),
    reportActionError: (message: string) => setActionError(message),
    rename,
    commitCell,
    paste,
    transferRange,
    undo,
    redo,
    changeRows,
    changeColumns,
    activateWorksheet,
    addWorksheet,
    renameWorksheet,
    deleteWorksheet,
    selectCell,
    createFilter,
    clearFilter,
    sortRange,
    setColumnFilter,
    saveValidation,
    deleteValidation,
    createPivot,
    applyPivot,
    refreshPivot,
    clearPivotError: () => setPivotError(null),
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  addWorksheet as addWorksheetRequest,
  applyPivotFields as applyPivotFieldsRequest,
  changeWorksheetStructure,
  clearWorksheetFilter as clearFilterRequest,
  createPivotTable as createPivotTableRequest,
  deleteValidationRule as deleteValidationRuleRequest,
  deleteWorksheet as deleteWorksheetRequest,
  fetchWorkbook,
  pasteRange,
  redoWorkbook,
  refreshPivotTable as refreshPivotTableRequest,
  requestErrorMessage,
  saveActiveWorksheet,
  saveCellValue,
  saveValidationRule as saveValidationRuleRequest,
  saveWorksheetFilter as saveFilterRequest,
  saveWorksheetSelection,
  sortRange as sortRangeRequest,
  transferRange,
  undoWorkbook,
} from "../workbooks/api";
import type { WorkbookPayload } from "../workbooks/api";
import { rawCellText } from "../workbooks/cells";
import type {
  ColumnFilterData,
  PivotFieldInput,
  SortRequestInput,
  ValidationRuleInput,
  WorkbookData,
  WorksheetData,
} from "../workbooks/types";
import {
  parseClipboardTable,
  rangeToTsv,
  type RangeClipboard,
  type RangeClipboardMode,
} from "./clipboard";
import {
  INITIAL_SELECTION,
  clampSelection,
  currentCellId,
  selectionOfWorksheet,
  selectionPayload,
  selectionRegion,
  startAddress,
  type GridSelection,
} from "./selection";
import { makeCellId, type CellAddress, type CellRegion } from "../lib/cells";
import { PIVOT_REGION_MESSAGE } from "./pivot";
import { dataBlockAt } from "./filters";
import type { StructureChangeRequest } from "./structure";

export const CLIPBOARD_UNAVAILABLE_MESSAGE =
  "The clipboard could not be read. Select a cell and paste with Ctrl+V instead.";
export const CROSS_WORKSHEET_PASTE_MESSAGE =
  "Ranges can only be copied and pasted inside the same worksheet.";
export const FILTER_REGION_MESSAGE = "Select a range with a header row to create a filter.";
export const SORT_REGION_MESSAGE = "Select a range with a header row to sort.";

/** Reads the system clipboard text, or null when the browser refuses access. */
async function readSystemClipboard(): Promise<string | null> {
  try {
    const text = await navigator.clipboard?.readText?.();
    return typeof text === "string" ? text : null;
  } catch {
    return null;
  }
}

/**
 * Mirrors the internal clipboard on the system clipboard so a copy can also be pasted into another
 * application. The browser may refuse the write; the internal clipboard keeps working regardless.
 */
function writeSystemClipboard(text: string): void {
  try {
    const pending = navigator.clipboard?.writeText?.(text);
    if (pending) void pending.catch(() => undefined);
  } catch {
    // The internal range clipboard still carries the copied rectangle.
  }
}

interface Draft {
  worksheetId: string;
  cellId: string;
  text: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; workbook: WorkbookData; canUndo: boolean; canRedo: boolean };

export interface SpreadsheetSession {
  status: LoadState["status"];
  errorMessage: string;
  workbook: WorkbookData | null;
  activeWorksheet: WorksheetData | null;
  selection: GridSelection;
  activeCellId: string;
  /** Text the formula bar shows: the edit in progress, otherwise the submitted cell text. */
  formulaBarText: string;
  inlineCellId: string | null;
  inlineText: string | null;
  notice: string | null;
  busy: boolean;
  /** True while the session history of this workbook holds a change the user can undo (REQ-3-2-2). */
  canUndo: boolean;
  /** True while the last undone change of this workbook can still be redone. */
  canRedo: boolean;
  /**
   * Restores the worksheet state from before the most recent change of this workbook; the affected
   * worksheet comes back with its values, formulas, structure, rules and selection. Nothing happens
   * while the history is empty, so Ctrl+Y cannot bring back a branch an edit replaced.
   */
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** Rectangle taken by the last copy or cut of the active worksheet, if any. */
  rangeClipboard: RangeClipboard | null;
  startEdit(cellId: string, seedText?: string): void;
  changeEdit(text: string): void;
  commitEdit(): Promise<void>;
  cancelEdit(): void;
  selectCells(selection: GridSelection): void;
  selectWorksheet(worksheetId: string): void;
  /** Adds a blank worksheet; the server names it with the first unused `SheetN` and activates it. */
  addWorksheet(): Promise<void>;
  /**
   * Deletes one worksheet (REQ-2-1-4). A rejection is reported by the server message; on success the
   * removed tab and its local state are dropped and the workbook the server returned is adopted.
   */
  deleteWorksheet(worksheetId: string): Promise<void>;
  /** Shows one message of this editor without running a request (guards the server also enforces). */
  showNotice(message: string): void;
  /** Takes the current selection for a copy; returns the text for the system clipboard. */
  copyRange(): string;
  /** Takes the current selection for a cut; returns the text for the system clipboard. */
  cutRange(): string;
  /** `start` overrides the rectangle corner a paste begins at (the cell a context menu was opened on). */
  pasteText(text: string | null, start?: CellAddress): Promise<void>;
  pasteFromClipboard(start?: CellAddress): Promise<void>;
  /** Replaces the editor state with a workbook another request returned (for example a rename). */
  replaceWorkbook(saved: WorkbookPayload): void;
  dismissNotice(): void;
  /** Creates a filter view over the data block of the current selection of the active worksheet. */
  createFilter(): Promise<void>;
  /** Opens the `Sort range` dialog for the selection: `null` (with a notice) when there is none. */
  sortSourceRegion(): CellRegion | null;
  /** Sorts the selected range by one of its columns; rejects so the dialog can show the error. */
  sortRange(payload: SortRequestInput): Promise<void>;
  /** Removes the filter view of the active worksheet; every source row becomes visible again. */
  clearFilter(): Promise<void>;
  /**
   * The source range a new pivot table reads: the selected rectangle, or the data block of a single
   * selected cell. Returns null (with a page notice) when no range with a header row is selected.
   */
  pivotSourceRegion(): CellRegion | null;
  /** Creates the pivot result worksheet of a source range; rejects so the dialog can show the error. */
  createPivotTable(region: CellRegion): Promise<void>;
  /** Applies one field selection of the pivot table editor; rejects so the editor shows the error. */
  applyPivotFields(payload: PivotFieldInput): Promise<void>;
  /** Rebuilds the summary of a pivot worksheet from its stored configuration. */
  refreshPivotTable(): Promise<void>;
  /** Replaces the column filters of the active filter view; rejects so a dialog can show the error. */
  saveColumnFilter(columns: ColumnFilterData[]): Promise<void>;
  /** Stores a validation rule for a target range; rejects so the dialog can show the error. */
  saveValidationRule(payload: ValidationRuleInput): Promise<void>;
  /** Removes one validation rule; rejects so the dialog can show the error. */
  deleteValidationRule(ruleId: string): Promise<void>;
  /**
   * Inserts or deletes one row or column of the active worksheet (REQ-2-2). A rejection is shown as
   * a page notice and leaves the grid with the structure it had before the command.
   */
  changeStructure(change: StructureChangeRequest): Promise<void>;
  /** Writes one cell for a dropdown selection; the rule of the cell is enforced by the server. */
  writeCellValue(cellId: string, value: string): Promise<void>;
}

function selectionMapOf(workbook: WorkbookData): Record<string, GridSelection> {
  const map: Record<string, GridSelection> = {};
  for (const worksheet of workbook.worksheets) map[worksheet.id] = selectionOfWorksheet(worksheet);
  return map;
}

/**
 * Owns the editor state of one workbook: the loaded workbook, the selection of every worksheet, the
 * edit in progress and the mutations that persist them. Mutations are serialized, so a late response
 * can never replace the workbook with an older revision.
 */
export function useSpreadsheetSession(workbookId: string): SpreadsheetSession {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selections, setSelections] = useState<Record<string, GridSelection>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [inlineCellId, setInlineCellId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rangeClipboard, setRangeClipboard] = useState<RangeClipboard | null>(null);

  const workbookRef = useRef<WorkbookData | null>(null);
  const selectionsRef = useRef<Record<string, GridSelection>>({});
  const rangeClipboardRef = useRef<RangeClipboard | null>(null);
  const pastingRef = useRef(false);
  const draftRef = useRef<Draft | null>(null);
  const savingDraft = useRef<string | null>(null);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const syncRef = useRef<{ sending: boolean; queued: Set<string> }>({ sending: false, queued: new Set() });
  /** Rectangle already stored on the server, so an unchanged selection is not sent again. */
  const syncedRef = useRef<Record<string, string>>({});
  const syncPendingRef = useRef<Map<string, string>>(new Map());
  const activeWorksheetRef = useRef<WorksheetData | null>(null);
  const activeCellIdRef = useRef<string>("A1");
  /** Availability of undo and redo, readable from the keyboard handler without re-binding it. */
  const historyRef = useRef({ canUndo: false, canRedo: false });
  /**
   * Worksheet a running `selectWorksheet` is switching to: a workbook another request returns
   * while the switch is being stored keeps this tab active, so the view cannot flip back.
   */
  const pendingActiveRef = useRef<string | null>(null);

  const applyWorkbook = useCallback((payload: WorkbookPayload) => {
    const pending = pendingActiveRef.current;
    const workbook =
      pending && payload.workbook.worksheets.some((worksheet) => worksheet.id === pending)
        ? { ...payload.workbook, activeWorksheetId: pending }
        : payload.workbook;
    workbookRef.current = workbook;
    setState({
      status: "ready",
      workbook,
      canUndo: payload.canUndo,
      canRedo: payload.canRedo,
    });
  }, []);

  const setDraftValue = useCallback((next: Draft | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const runExclusive = useCallback(<T>(task: () => Promise<T>): Promise<T> => {
    const result = queueRef.current.then(task, task);
    queueRef.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }, []);

  /**
   * Takes the selections of a workbook the server returned (the loaded one, or one an undo or redo
   * restored): the grid shows the stored rectangle again and the sync state matches it, so an
   * unchanged selection is not sent back.
   */
  const adoptSelections = useCallback((workbook: WorkbookData) => {
    const map = selectionMapOf(workbook);
    selectionsRef.current = map;
    setSelections(map);
    syncedRef.current = Object.fromEntries(
      Object.entries(map).map(([worksheetId, value]) => [worksheetId, JSON.stringify(selectionPayload(value))]),
    );
    syncPendingRef.current.clear();
  }, []);

  useEffect(() => {
    let active = true;
    pendingActiveRef.current = null;
    setState({ status: "loading" });
    setDraftValue(null);
    setInlineCellId(null);
    setNotice(null);
    rangeClipboardRef.current = null;
    setRangeClipboard(null);
    selectionsRef.current = {};
    setSelections({});
    fetchWorkbook(workbookId)
      .then((payload) => {
        if (!active) return;
        adoptSelections(payload.workbook);
        workbookRef.current = payload.workbook;
        setState({
          status: "ready",
          workbook: payload.workbook,
          canUndo: payload.canUndo,
          canRedo: payload.canRedo,
        });
      })
      .catch((error) => {
        if (active) setState({ status: "error", message: requestErrorMessage(error) });
      });
    return () => {
      active = false;
    };
  }, [workbookId, adoptSelections, setDraftValue]);

  const workbook = state.status === "ready" ? state.workbook : null;
  const activeWorksheet =
    workbook?.worksheets.find((worksheet) => worksheet.id === workbook.activeWorksheetId) ??
    workbook?.worksheets[0] ??
    null;

  const selection = (activeWorksheet && selections[activeWorksheet.id]) || INITIAL_SELECTION;
  const activeCellId = currentCellId(selection);
  activeWorksheetRef.current = activeWorksheet;
  activeCellIdRef.current = activeCellId;
  const canUndo = state.status === "ready" ? state.canUndo : false;
  const canRedo = state.status === "ready" ? state.canRedo : false;
  historyRef.current = { canUndo, canRedo };

  const worksheetById = useCallback(
    (worksheetId: string) => workbookRef.current?.worksheets.find((worksheet) => worksheet.id === worksheetId) ?? null,
    [],
  );

  const clearDraftIfCurrent = useCallback(
    (pending: Draft) => {
      const current = draftRef.current;
      if (
        current &&
        current.worksheetId === pending.worksheetId &&
        current.cellId === pending.cellId &&
        current.text === pending.text
      ) {
        setDraftValue(null);
      }
    },
    [setDraftValue],
  );

  const commitEdit = useCallback(async (): Promise<void> => {
    const pending = draftRef.current;
    if (!pending) return;
    const stored = rawCellText(worksheetById(pending.worksheetId) ?? undefined, pending.cellId);
    if (pending.text === stored) {
      clearDraftIfCurrent(pending);
      setInlineCellId(null);
      return;
    }
    const key = `${pending.worksheetId}|${pending.cellId}`;
    if (savingDraft.current === key) return;
    savingDraft.current = key;
    try {
      const updated = await runExclusive(() =>
        saveCellValue(workbookId, pending.worksheetId, pending.cellId, pending.text),
      );
      applyWorkbook(updated);
      clearDraftIfCurrent(pending);
      setInlineCellId(null);
      setNotice(null);
    } catch (error) {
      clearDraftIfCurrent(pending);
      setInlineCellId(null);
      setNotice(requestErrorMessage(error));
    } finally {
      savingDraft.current = null;
    }
  }, [applyWorkbook, clearDraftIfCurrent, runExclusive, worksheetById, workbookId]);

  const flushSelectionSync = useCallback(async () => {
    if (syncRef.current.sending) return;
    const queued = Array.from(syncRef.current.queued);
    if (queued.length === 0) return;
    syncRef.current.queued.clear();
    syncRef.current.sending = true;
    try {
      for (const worksheetId of queued) {
        const next = selectionsRef.current[worksheetId];
        const key = next ? JSON.stringify(selectionPayload(next)) : null;
        if (!next || !key || !worksheetById(worksheetId)) continue;
        await saveWorksheetSelection(workbookId, worksheetId, selectionPayload(next));
        syncedRef.current[worksheetId] = key;
        if (syncPendingRef.current.get(worksheetId) === key) syncPendingRef.current.delete(worksheetId);
      }
    } catch {
      // A selection is view state: a failed save only means the next refresh starts at the last
      // successfully stored rectangle, so the grid keeps working with the current one.
    } finally {
      syncRef.current.sending = false;
      if (syncRef.current.queued.size > 0) void flushSelectionSync();
    }
  }, [worksheetById, workbookId]);

  const queueSelectionSync = useCallback(
    (worksheetId: string, next: GridSelection) => {
      const key = JSON.stringify(selectionPayload(next));
      if (syncedRef.current[worksheetId] === key || syncPendingRef.current.get(worksheetId) === key) return;
      syncPendingRef.current.set(worksheetId, key);
      syncRef.current.queued.add(worksheetId);
      void flushSelectionSync();
    },
    [flushSelectionSync],
  );

  const applySelection = useCallback(
    (worksheet: WorksheetData, next: GridSelection) => {
      const clamped = clampSelection(next, worksheet);
      const updatedMap = { ...selectionsRef.current, [worksheet.id]: clamped };
      selectionsRef.current = updatedMap;
      setSelections(updatedMap);
      queueSelectionSync(worksheet.id, clamped);
    },
    [queueSelectionSync],
  );

  const selectCells = useCallback(
    (next: GridSelection) => {
      const worksheet = activeWorksheetRef.current;
      if (!worksheet) return;
      void commitEdit();
      setInlineCellId(null);
      applySelection(worksheet, next);
    },
    [applySelection, commitEdit],
  );

  const startEdit = useCallback(
    (cellId: string, seedText?: string) => {
      const worksheet = activeWorksheetRef.current;
      if (!worksheet) return;
      setInlineCellId(cellId);
      setDraftValue({ worksheetId: worksheet.id, cellId, text: seedText ?? rawCellText(worksheet, cellId) });
    },
    [setDraftValue],
  );

  const changeEdit = useCallback(
    (text: string) => {
      const worksheet = activeWorksheetRef.current;
      if (!worksheet) return;
      const cellId = activeCellIdRef.current;
      const current = draftRef.current;
      if (current && current.worksheetId === worksheet.id && current.cellId === cellId) {
        setDraftValue({ ...current, text });
        return;
      }
      setDraftValue({ worksheetId: worksheet.id, cellId, text });
    },
    [setDraftValue],
  );

  const cancelEdit = useCallback(() => {
    setDraftValue(null);
    setInlineCellId(null);
  }, [setDraftValue]);

  /** Writes a table from the system clipboard at the current selection, or at `start` when given. */
  const pasteTable = useCallback(
    async (text: string, start?: CellAddress) => {
      const worksheet = activeWorksheetRef.current;
      if (!worksheet) return;
      const table = parseClipboardTable(text);
      if (table.length === 0) return;
      const from = start ?? startAddress(selectionsRef.current[worksheet.id] ?? INITIAL_SELECTION);
      const width = table.reduce((widest, row) => Math.max(widest, row.length), 0);
      await commitEdit();
      setBusy(true);
      try {
        const updated = await runExclusive(() =>
          pasteRange(workbookId, worksheet.id, makeCellId(from.row, from.column), table),
        );
        applyWorkbook(updated);
        const stored = updated.workbook.worksheets.find((candidate) => candidate.id === worksheet.id) ?? worksheet;
        applySelection(stored, {
          anchor: from,
          focus: { row: from.row + table.length - 1, column: from.column + Math.max(width, 1) - 1 },
        });
        setNotice(null);
      } catch (error) {
        setNotice(requestErrorMessage(error));
      } finally {
        setBusy(false);
      }
    },
    [applySelection, applyWorkbook, commitEdit, runExclusive, workbookId],
  );

  /** Takes the rectangle selected in the active worksheet for a later paste in the same worksheet. */
  const startRangeClipboard = useCallback((mode: RangeClipboardMode): string => {
    const worksheet = activeWorksheetRef.current;
    if (!worksheet) return "";
    const region = selectionRegion(selectionsRef.current[worksheet.id] ?? INITIAL_SELECTION);
    const next: RangeClipboard = { worksheetId: worksheet.id, mode, region };
    rangeClipboardRef.current = next;
    setRangeClipboard(next);
    setNotice(null);
    const text = rangeToTsv(worksheet, region);
    writeSystemClipboard(text);
    return text;
  }, []);

  const copyRange = useCallback(() => startRangeClipboard("copy"), [startRangeClipboard]);
  const cutRange = useCallback(() => startRangeClipboard("cut"), [startRangeClipboard]);

  /**
   * Applies the internal range clipboard at the current selection, or at `start` when given: the
   * server writes the whole target rectangle (and clears the source of a cut) in one update, or
   * refuses the operation as a whole.
   */
  const applyRangeClipboard = useCallback(
    async (clip: RangeClipboard, start?: CellAddress) => {
      const worksheet = activeWorksheetRef.current;
      if (!worksheet) return;
      const from = start ?? startAddress(selectionsRef.current[worksheet.id] ?? INITIAL_SELECTION);
      const height = clip.region.bottom - clip.region.top + 1;
      const width = clip.region.right - clip.region.left + 1;
      await commitEdit();
      setBusy(true);
      try {
        const updated = await runExclusive(() =>
          transferRange(workbookId, worksheet.id, {
            mode: clip.mode,
            source: clip.region,
            target: makeCellId(from.row, from.column),
          }),
        );
        applyWorkbook(updated);
        if (clip.mode === "cut") {
          rangeClipboardRef.current = null;
          setRangeClipboard(null);
        }
        const stored = updated.workbook.worksheets.find((candidate) => candidate.id === worksheet.id) ?? worksheet;
        applySelection(stored, {
          anchor: from,
          focus: { row: from.row + height - 1, column: from.column + width - 1 },
        });
        setNotice(null);
      } catch (error) {
        setNotice(requestErrorMessage(error));
      } finally {
        setBusy(false);
      }
    },
    [applySelection, applyWorkbook, commitEdit, runExclusive, workbookId],
  );

  /**
   * The single paste entry point: the internal clipboard of this worksheet wins, otherwise the system
   * clipboard text (given by the paste event when the browser provided it) is written as a table.
   */
  const paste = useCallback(
    async (systemText: string | null, start?: CellAddress) => {
      const worksheet = activeWorksheetRef.current;
      if (!worksheet || pastingRef.current) return;
      pastingRef.current = true;
      try {
        const clip = rangeClipboardRef.current;
        if (clip && clip.worksheetId === worksheet.id) {
          await applyRangeClipboard(clip, start);
          return;
        }
        if (clip) {
          setNotice(CROSS_WORKSHEET_PASTE_MESSAGE);
          return;
        }
        const text = systemText === null || systemText === "" ? await readSystemClipboard() : systemText;
        if (text === null || text === "") {
          setNotice(CLIPBOARD_UNAVAILABLE_MESSAGE);
          return;
        }
        await pasteTable(text, start);
      } finally {
        pastingRef.current = false;
      }
    },
    [applyRangeClipboard, pasteTable],
  );

  const pasteText = useCallback((text: string | null, start?: CellAddress) => paste(text, start), [paste]);
  const pasteFromClipboard = useCallback((start?: CellAddress) => paste(null, start), [paste]);

  /**
   * Switches the active worksheet (REQ-2-1-2): the tab, the grid, the row and column structure, the
   * stored selection, the formula bar, the filter buttons, the validation entry points and the pivot
   * editor follow the click at once, while the request only stores which worksheet is active. A
   * failed request restores the last successfully active worksheet and reports the reason.
   */
  const selectWorksheet = useCallback(
    async (worksheetId: string) => {
      const current = workbookRef.current;
      if (!current || worksheetId === current.activeWorksheetId) return;
      if (!current.worksheets.some((worksheet) => worksheet.id === worksheetId)) return;
      await commitEdit();
      const stored = workbookRef.current ?? current;
      setInlineCellId(null);
      pendingActiveRef.current = worksheetId;
      applyWorkbook({
        workbook: { ...stored, activeWorksheetId: worksheetId },
        canUndo: historyRef.current.canUndo,
        canRedo: historyRef.current.canRedo,
      });
      try {
        const updated = await runExclusive(() => saveActiveWorksheet(stored.id, worksheetId));
        pendingActiveRef.current = null;
        applyWorkbook(updated);
        setNotice(null);
      } catch (error) {
        pendingActiveRef.current = null;
        const latest = workbookRef.current;
        if (latest) {
          applyWorkbook({
            workbook: { ...latest, activeWorksheetId: stored.activeWorksheetId },
            canUndo: historyRef.current.canUndo,
            canRedo: historyRef.current.canRedo,
          });
        }
        setNotice(requestErrorMessage(error));
      }
    },
    [applyWorkbook, commitEdit, runExclusive],
  );

  /**
   * Adds a blank worksheet to the workbook. The returned workbook carries the new worksheet as the
   * active one, so the tab bar and the grid follow it; a failure leaves the current state as it is.
   */
  const addWorksheet = useCallback(async (): Promise<void> => {
    const current = workbookRef.current;
    if (!current) return;
    await commitEdit();
    setInlineCellId(null);
    setBusy(true);
    try {
      const updated = await runExclusive(() => addWorksheetRequest(current.id));
      applyWorkbook(updated);
      setNotice(null);
    } catch (error) {
      setNotice(requestErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [applyWorkbook, commitEdit, runExclusive]);

  const replaceWorkbook = useCallback(
    (saved: WorkbookPayload) => {
      applyWorkbook(saved);
    },
    [applyWorkbook],
  );

  /**
   * Deletes one worksheet: the server removes the tab with everything it holds and activates an
   * adjacent worksheet when the deleted one was active. The local selection of the removed
   * worksheet and a range clipboard pointing at it are dropped, so no later action can use them.
   */
  const deleteWorksheet = useCallback(
    async (worksheetId: string): Promise<void> => {
      const current = workbookRef.current;
      if (!current) return;
      await commitEdit();
      if (draftRef.current?.worksheetId === worksheetId) setDraftValue(null);
      setInlineCellId(null);
      setBusy(true);
      try {
        const updated = await runExclusive(() => deleteWorksheetRequest(current.id, worksheetId));
        applyWorkbook(updated);
        const remaining = new Set(updated.workbook.worksheets.map((worksheet) => worksheet.id));
        const nextSelections = Object.fromEntries(
          Object.entries(selectionsRef.current).filter(([id]) => remaining.has(id)),
        );
        selectionsRef.current = nextSelections;
        setSelections(nextSelections);
        delete syncedRef.current[worksheetId];
        syncPendingRef.current.delete(worksheetId);
        syncRef.current.queued.delete(worksheetId);
        if (rangeClipboardRef.current?.worksheetId === worksheetId) {
          rangeClipboardRef.current = null;
          setRangeClipboard(null);
        }
        setNotice(null);
      } finally {
        setBusy(false);
      }
    },
    [applyWorkbook, commitEdit, runExclusive, setDraftValue],
  );

  const showNotice = useCallback((message: string) => setNotice(message), []);

  /**
   * Runs one worksheet mutation of the active worksheet: the edit in progress is committed first and
   * the returned workbook replaces the current one, so a rejected mutation leaves the state it had.
   */
  const mutateActiveWorksheet = useCallback(
    async (task: (workbookId: string, worksheetId: string) => Promise<WorkbookPayload>): Promise<boolean> => {
      const worksheet = activeWorksheetRef.current;
      if (!worksheet) return false;
      await commitEdit();
      const updated = await runExclusive(() => task(workbookId, worksheet.id));
      applyWorkbook(updated);
      return true;
    },
    [applyWorkbook, commitEdit, runExclusive, workbookId],
  );

  /**
   * The region a range command of the `Data` menu works on: the selected rectangle, or the data
   * block of a single selected cell. Returns null (with `missingMessage` shown) when no range with
   * a header row is available, so the command can say why it did not open.
   */
  const rangeCommandRegion = useCallback((missingMessage: string): CellRegion | null => {
    const worksheet = activeWorksheetRef.current;
    if (!worksheet) return null;
    const region = selectionRegion(selectionsRef.current[worksheet.id] ?? INITIAL_SELECTION);
    const single = region.top === region.bottom && region.left === region.right;
    const target = single ? dataBlockAt(worksheet, { row: region.top, column: region.left }) : region;
    if (!target || target.bottom === target.top) {
      setNotice(missingMessage);
      return null;
    }
    return target;
  }, []);

  /** The region a filter is created for: the selection, or its data block when one cell is selected. */
  const filterTargetRegion = useCallback(
    () => rangeCommandRegion(FILTER_REGION_MESSAGE),
    [rangeCommandRegion],
  );

  const createFilter = useCallback(async () => {
    const region = filterTargetRegion();
    if (!region) return;
    try {
      await mutateActiveWorksheet((id, worksheetId) =>
        saveFilterRequest(id, worksheetId, { region, columns: [] }),
      );
      setNotice(null);
    } catch (error) {
      setNotice(requestErrorMessage(error));
    }
  }, [filterTargetRegion, mutateActiveWorksheet]);

  const clearFilter = useCallback(async () => {
    try {
      await mutateActiveWorksheet((id, worksheetId) => clearFilterRequest(id, worksheetId));
      setNotice(null);
    } catch (error) {
      setNotice(requestErrorMessage(error));
    }
  }, [mutateActiveWorksheet]);

  /** The region a pivot table is created for: the selection, or its data block for one cell. */
  const pivotSourceRegion = useCallback(
    () => rangeCommandRegion(PIVOT_REGION_MESSAGE),
    [rangeCommandRegion],
  );

  /** The range a `Sort range` command reorders: the selection, or the data block of one cell. */
  const sortSourceRegion = useCallback(() => rangeCommandRegion(SORT_REGION_MESSAGE), [rangeCommandRegion]);

  /**
   * Sorts the selected range by one of its columns (REQ-5-1-1). The server answers with the whole
   * workbook holding the records in their new rows, so the grid shows the sorted order at once; a
   * refusal rejects to the dialog and leaves the stored order as it was.
   */
  const sortRange = useCallback(
    async (payload: SortRequestInput): Promise<void> => {
      await mutateActiveWorksheet((id, worksheetId) => sortRangeRequest(id, worksheetId, payload));
      setNotice(null);
    },
    [mutateActiveWorksheet],
  );

  /**
   * Creates the pivot result worksheet of the source range and opens it: the returned workbook
   * carries it as the active worksheet, so the tab bar, the grid and the `Pivot table editor` follow
   * it. A failure leaves the editor state as it is and is reported to the dialog.
   */
  const createPivotTable = useCallback(
    async (region: CellRegion): Promise<void> => {
      const current = workbookRef.current;
      const worksheet = activeWorksheetRef.current;
      if (!current || !worksheet) return;
      await commitEdit();
      setInlineCellId(null);
      setBusy(true);
      try {
        const updated = await runExclusive(() =>
          createPivotTableRequest(current.id, { sourceWorksheetId: worksheet.id, sourceRange: region }),
        );
        applyWorkbook(updated);
        setNotice(null);
      } finally {
        setBusy(false);
      }
    },
    [applyWorkbook, commitEdit, runExclusive],
  );

  /** Applies the fields of the pivot table editor; a rejected configuration stores nothing. */
  const applyPivotFields = useCallback(
    async (payload: PivotFieldInput): Promise<void> => {
      const worksheet = activeWorksheetRef.current;
      if (!worksheet) return;
      const updated = await runExclusive(() => applyPivotFieldsRequest(workbookId, worksheet.id, payload));
      applyWorkbook(updated);
      setNotice(null);
    },
    [applyWorkbook, runExclusive, workbookId],
  );

  /** Recomputes the summary of the active pivot worksheet; a failure keeps the last result. */
  const refreshPivotTable = useCallback(async (): Promise<void> => {
    const worksheet = activeWorksheetRef.current;
    if (!worksheet) return;
    const updated = await runExclusive(() => refreshPivotTableRequest(workbookId, worksheet.id));
    applyWorkbook(updated);
    setNotice(null);
  }, [applyWorkbook, runExclusive, workbookId]);

  const saveColumnFilter = useCallback(
    async (columns: ColumnFilterData[]) => {
      const region = activeWorksheetRef.current?.filter?.region;
      if (!region) return;
      await mutateActiveWorksheet((id, worksheetId) =>
        saveFilterRequest(id, worksheetId, { region, columns }),
      );
    },
    [mutateActiveWorksheet],
  );

  const saveValidationRule = useCallback(
    async (payload: ValidationRuleInput) => {
      await mutateActiveWorksheet((id, worksheetId) =>
        saveValidationRuleRequest(id, worksheetId, payload),
      );
    },
    [mutateActiveWorksheet],
  );

  const deleteValidationRule = useCallback(
    async (ruleId: string) => {
      await mutateActiveWorksheet((id, worksheetId) =>
        deleteValidationRuleRequest(id, worksheetId, ruleId),
      );
    },
    [mutateActiveWorksheet],
  );

  const writeCellValue = useCallback(
    async (cellId: string, value: string) => {
      const worksheet = activeWorksheetRef.current;
      if (!worksheet) return;
      try {
        const updated = await runExclusive(() => saveCellValue(workbookId, worksheet.id, cellId, value));
        applyWorkbook(updated);
        setNotice(null);
      } catch (error) {
        setNotice(requestErrorMessage(error));
      }
    },
    [applyWorkbook, runExclusive, workbookId],
  );

  /**
   * Applies one row or column structure command to the active worksheet. The server returns the whole
   * workbook, so the grid, the selection and the formula bar follow the shifted worksheet; a failed
   * command shows an error and leaves the last successfully stored structure in place.
   */
  const changeStructure = useCallback(
    async (change: StructureChangeRequest): Promise<void> => {
      const worksheet = activeWorksheetRef.current;
      if (!worksheet) return;
      await commitEdit();
      setInlineCellId(null);
      setBusy(true);
      try {
        const updated = await runExclusive(() => changeWorksheetStructure(workbookId, worksheet.id, change));
        applyWorkbook(updated);
        const stored = updated.workbook.worksheets.find((candidate) => candidate.id === worksheet.id);
        if (stored) applySelection(stored, selectionOfWorksheet(stored));
        setNotice(null);
      } catch (error) {
        setNotice(requestErrorMessage(error));
      } finally {
        setBusy(false);
      }
    },
    [applySelection, applyWorkbook, commitEdit, runExclusive, workbookId],
  );

  /**
   * Steps the session history of this workbook one change back (undo) or forward (redo). The server
   * writes the restored worksheet - values, original formulas, structure, rules, filter view and
   * selection - into the store, so the visible state survives a refresh; the selection of every
   * worksheet is taken from the restored workbook. An empty branch is a no-op, so Ctrl+Y can never
   * bring back a branch a new change replaced.
   */
  const runHistoryStep = useCallback(
    async (direction: "undo" | "redo"): Promise<void> => {
      const current = workbookRef.current;
      if (!current) return;
      if (direction === "undo" ? !historyRef.current.canUndo : !historyRef.current.canRedo) return;
      setDraftValue(null);
      setInlineCellId(null);
      setBusy(true);
      try {
        const restored = await runExclusive(() =>
          direction === "undo" ? undoWorkbook(current.id) : redoWorkbook(current.id),
        );
        applyWorkbook(restored);
        adoptSelections(restored.workbook);
        setNotice(null);
      } catch (error) {
        setNotice(requestErrorMessage(error));
      } finally {
        setBusy(false);
      }
    },
    [adoptSelections, applyWorkbook, runExclusive, setDraftValue],
  );

  const undo = useCallback(() => runHistoryStep("undo"), [runHistoryStep]);
  const redo = useCallback(() => runHistoryStep("redo"), [runHistoryStep]);

  // Ctrl+Z and Ctrl+Y run the same two commands as the toolbar buttons (REQ-3-2-2).
  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      event.preventDefault();
      void runHistoryStep(key === "z" ? "undo" : "redo");
    };
    document.addEventListener("keydown", handleHistoryShortcut);
    return () => document.removeEventListener("keydown", handleHistoryShortcut);
  }, [runHistoryStep]);

  const formulaBarText = useMemo(() => {
    if (draft && draft.worksheetId === activeWorksheet?.id && draft.cellId === activeCellId) return draft.text;
    return rawCellText(activeWorksheet ?? undefined, activeCellId);
  }, [activeWorksheet, activeCellId, draft]);

  return {
    status: state.status,
    errorMessage: state.status === "error" ? state.message : "",
    workbook,
    activeWorksheet,
    selection,
    activeCellId,
    formulaBarText,
    inlineCellId,
    inlineText: draft ? draft.text : null,
    notice,
    busy,
    canUndo,
    canRedo,
    undo,
    redo,
    rangeClipboard,
    startEdit,
    changeEdit,
    commitEdit,
    cancelEdit,
    selectCells,
    selectWorksheet,
    addWorksheet,
    deleteWorksheet,
    showNotice,
    copyRange,
    cutRange,
    pasteText,
    pasteFromClipboard,
    replaceWorkbook,
    dismissNotice: () => setNotice(null),
    createFilter,
    clearFilter,
    sortSourceRegion,
    sortRange,
    pivotSourceRegion,
    createPivotTable,
    applyPivotFields,
    refreshPivotTable,
    saveColumnFilter,
    saveValidationRule,
    deleteValidationRule,
    writeCellValue,
    changeStructure,
  };
}

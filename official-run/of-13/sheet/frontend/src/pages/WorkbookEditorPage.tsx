import { useCallback, useEffect, useRef, useState } from "react";

import {
  addWorksheet,
  changeColumnStructure,
  changeRowStructure,
  deleteWorksheet,
  fetchWorkbook,
  pasteCells,
  renameWorkbook,
  renameWorksheet,
  restoreWorksheetState,
  saveWorksheetFilter,
  saveWorksheetSelection,
  saveWorksheetValidations,
  setActiveWorksheet,
  transferRange,
  updateCell,
} from "../api/workbooks";
import { DataMenu } from "../components/DataMenu";
import { CreatePivotTableDialog } from "../components/CreatePivotTableDialog";
import {
  DataValidationDialog,
  type ValidationDraft,
} from "../components/DataValidationDialog";
import { DeleteWorksheetDialog } from "../components/DeleteWorksheetDialog";
import { EditorToolbar } from "../components/EditorToolbar";
import { ExportCsvButton } from "../components/ExportCsvButton";
import { FilterDialog, type FilterDraft } from "../components/FilterDialog";
import { PivotTableEditor } from "../components/PivotTableEditor";
import { RenameWorkbookDialog } from "../components/RenameWorkbookDialog";
import { RenameWorksheetDialog } from "../components/RenameWorksheetDialog";
import { SortRangeDialog } from "../components/SortRangeDialog";
import { WorksheetGrid } from "../components/WorksheetGrid";
import { WorksheetTabs } from "../components/WorksheetTabs";
import {
  buildRangeClipboard,
  isRangeClipboardText,
  targetSelectionFor,
  type RangeClipboard,
  type RangeTransferMode,
} from "../domain/clipboard";
import {
  EMPTY_HISTORY,
  recordHistory,
  redoHistory,
  snapshotWorksheet,
  undoHistory,
  type HistoryState,
  type WorksheetSnapshot,
} from "../domain/history";
import { type CellSelection } from "../domain/spreadsheet";
import {
  STRUCTURE_BUSY_MESSAGE,
  STRUCTURE_FAILURE_MESSAGE,
  type StructureOperation,
} from "../domain/structure";
import { cellInput, WORKSHEET_LAST_REMAINING_MESSAGE, type WorkbookState, type WorksheetState } from "../domain/workbook";
import { useDataTools } from "./use-data-tools";
import { formatUpdatedAt } from "../lib/format";
import { makeHash } from "../lib/hash-route";
import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";

const DEFAULT_SELECTION: CellSelection = { start: "A1", end: "A1" };
const CELL_BUSY_MESSAGE = "Updating cell…";
const PASTE_FAILURE_MESSAGE = "Unable to paste";
const CLIPBOARD_FAILURE_MESSAGE = "Unable to read the clipboard";
const CLIPBOARD_EMPTY_MESSAGE = "There is nothing to paste";
const UNDO_FAILURE_MESSAGE = "Unable to undo";
const REDO_FAILURE_MESSAGE = "Unable to redo";

export interface WorkbookEditorPageProps {
  workbookId: string;
}

type LoadState = "loading" | "ready" | "error";

interface CellEdit {
  address: string;
  value: string;
  /** Where the uncommitted text was typed; only a grid edit renders the inline box. */
  origin: "grid" | "formula";
}

function resolveActiveSheet(workbook: WorkbookState, activeSheetId: string): WorksheetState | undefined {
  return workbook.sheets.find((sheet) => sheet.id === activeSheetId) ?? workbook.sheets[0];
}

/** Rectangle of the most recent successful selection of a worksheet, or A1. */
function sheetSelection(sheet: WorksheetState | undefined): CellSelection {
  if (!sheet?.selection) return DEFAULT_SELECTION;
  return { start: sheet.selection.start, end: sheet.selection.end };
}

export function WorkbookEditorPage({ workbookId }: WorkbookEditorPageProps) {
  const [state, setState] = useState<LoadState>("loading");
  const [workbook, setWorkbook] = useState<WorkbookState | null>(null);
  const [error, setError] = useState("");
  const [activeSheetId, setActiveSheetId] = useState("");
  const [selection, setSelection] = useState<CellSelection>(DEFAULT_SELECTION);
  const [anchor, setAnchor] = useState(DEFAULT_SELECTION.start);
  const [edit, setEdit] = useState<CellEdit | null>(null);
  const [cellBusy, setCellBusy] = useState(false);
  const [cellError, setCellError] = useState("");
  const [clipboardNotice, setClipboardNotice] = useState("");
  const [history, setHistory] = useState<HistoryState>(EMPTY_HISTORY);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const renameButtonRef = useRef<HTMLButtonElement>(null);
  const [renameSheet, setRenameSheet] = useState<WorksheetState | null>(null);
  const [deleteSheetTarget, setDeleteSheetTarget] = useState<WorksheetState | null>(null);
  const [deletingSheet, setDeletingSheet] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sheetError, setSheetError] = useState("");
  const [structureBusy, setStructureBusy] = useState(false);
  const [structureError, setStructureError] = useState("");
  const selectionRef = useRef<CellSelection>(DEFAULT_SELECTION);
  const editRef = useRef<CellEdit | null>(null);
  const busyRef = useRef(false);
  const historyBusyRef = useRef(false);
  const workbookRef = useRef<WorkbookState | null>(null);
  const activeSheetIdRef = useRef("");
  const sheetRef = useRef<WorksheetState | null>(null);
  const historyRef = useRef<HistoryState>(EMPTY_HISTORY);
  const clipboardRef = useRef<RangeClipboard | null>(null);
  const externalTextRef = useRef("");

  /** Single entry point for the uncommitted edit so event handlers never see a stale value. */
  function applyEdit(next: CellEdit | null) {
    editRef.current = next;
    setEdit(next);
  }

  function applyHistory(next: HistoryState) {
    historyRef.current = next;
    setHistory(next);
  }

  function applyClipboard(next: RangeClipboard | null) {
    clipboardRef.current = next;
  }

  function applySelection(next: CellSelection) {
    selectionRef.current = next;
    setSelection(next);
    setAnchor(next.start);
  }

  function applyWorkbook(next: WorkbookState | null) {
    workbookRef.current = next;
    setWorkbook(next);
  }

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setError("");
    applyWorkbook(null);
    applyEdit(null);
    setCellError("");
    setHistoryError("");
    setClipboardNotice("");
    applyClipboard(null);
    applyHistory(EMPTY_HISTORY);
    applySelection(DEFAULT_SELECTION);
    setActiveSheetId("");
    activeSheetIdRef.current = "";

    fetchWorkbook(workbookId)
      .then(({ workbook: loaded }) => {
        if (cancelled) return;
        applyWorkbook(loaded);
        activeSheetIdRef.current = loaded.activeSheetId;
        setActiveSheetId(loaded.activeSheetId);
        applySelection(sheetSelection(resolveActiveSheet(loaded, loaded.activeSheetId)));
        setState("ready");
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setError(failure instanceof Error ? failure.message : "Unable to load workbook");
        setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [workbookId]);

  const sheet = workbook ? resolveActiveSheet(workbook, activeSheetId) : undefined;
  sheetRef.current = sheet ?? null;

  const commandBusy = cellBusy || structureBusy || historyBusy;
  // Data-organization commands of the active worksheet (REQ-5).
  const dataTools = useDataTools({
    workbookId,
    sheet,
    selection,
    applyWorkbook,
    writeCell,
    commandBusy,
    openWorksheet: activateWorksheet,
  });

  const selectCell = useCallback(
    (address: string, options?: { extend?: boolean }) => {
      // Clicking another cell commits the change that was still being typed.
      const pending = editRef.current;
      if (pending && pending.address !== address) void commitEdit(pending.value);
      const next = options?.extend
        ? { start: selectionRef.current.start, end: address }
        : { start: address, end: address };
      selectionRef.current = next;
      setSelection(next);
      if (!options?.extend) setAnchor(address);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * Saves the rectangle of the selection gesture that just finished. The confirmed rectangle
   * is also mirrored onto its own worksheet in the visible workbook, so switching away and back
   * (or reopening) restores exactly the selection this worksheet had.
   */
  const persistSelection = useCallback(() => {
    const current = selectionRef.current;
    const target = activeSheetIdRef.current;
    if (!target) return;
    const latest = workbookRef.current;
    if (latest) {
      applyWorkbook({
        ...latest,
        sheets: latest.sheets.map((entry) =>
          entry.id === target ? { ...entry, selection: { ...current } } : entry,
        ),
      });
    }
    void saveWorksheetSelection(workbookId, target, current).catch(() => {
      /* The rectangle stays visible locally; the stored one is retried on the next gesture. */
    });
  }, [workbookId]);

  // ------------------------------------------------------------ undo / redo history

  /** Records the state a worksheet had before an operation that just succeeded. */
  function recordOperation(before: WorksheetSnapshot) {
    applyHistory(recordHistory(historyRef.current, before));
  }

  /** Replaces the visible workbook after a restore, following the restored worksheet. */
  function applyRestoredWorkbook(next: WorkbookState, sheetId: string) {
    applyWorkbook(next);
    applyEdit(null);
    if (sheetId !== activeSheetIdRef.current) {
      activeSheetIdRef.current = sheetId;
      setActiveSheetId(sheetId);
      void setActiveWorksheet(workbookId, sheetId).catch(() => {
        /* The restored worksheet stays local; the stored active one is retried on reopen. */
      });
    }
    const target = next.sheets.find((entry) => entry.id === sheetId);
    applySelection(sheetSelection(target));
  }

  const runHistoryStep = useCallback(
    async (kind: "undo" | "redo") => {
      const current = sheetRef.current;
      const step = current
        ? kind === "undo"
          ? undoHistory(historyRef.current, snapshotWorksheet(current))
          : redoHistory(historyRef.current, snapshotWorksheet(current))
        : null;
      if (!step || historyBusyRef.current || busyRef.current) return;
      historyBusyRef.current = true;
      setHistoryBusy(true);
      setHistoryError("");
      setCellError("");
      try {
        const result = await restoreWorksheetState(workbookId, step.snapshot.sheetId, step.snapshot);
        applyHistory(step.history);
        applyRestoredWorkbook(result.workbook, step.snapshot.sheetId);
      } catch (failure) {
        setHistoryError(
          failure instanceof Error
            ? failure.message
            : kind === "undo"
              ? UNDO_FAILURE_MESSAGE
              : REDO_FAILURE_MESSAGE,
        );
      } finally {
        historyBusyRef.current = false;
        setHistoryBusy(false);
      }
    },
    [workbookId],
  );

  const handleUndo = useCallback(() => void runHistoryStep("undo"), [runHistoryStep]);
  const handleRedo = useCallback(() => void runHistoryStep("redo"), [runHistoryStep]);

  // ------------------------------------------------------------------ range commands

  const startRangeCopy = useCallback((mode: RangeTransferMode) => {
    const current = sheetRef.current;
    if (!current || busyRef.current) return;
    const data = buildRangeClipboard(current, selectionRef.current, mode);
    if (!data) return;
    applyClipboard(data);
    setCellError("");
    setHistoryError("");
    const rectangle = `${data.source.start}:${data.source.end}`;
    setClipboardNotice(`${mode === "copy" ? "Copied" : "Cut"} ${rectangle}`);
    const clipboardApi = navigator.clipboard;
    if (clipboardApi?.writeText) void clipboardApi.writeText(data.text).catch(() => {});
  }, []);

  const handleCopy = useCallback(() => startRangeCopy("copy"), [startRangeCopy]);
  const handleCut = useCallback(() => startRangeCopy("cut"), [startRangeCopy]);

  /** Copy/cut + paste of one rectangle; the server applies all of it or none of it. */
  const moveRange = useCallback(
    async (data: RangeClipboard, target: CellSelection) => {
      const current = sheetRef.current;
      // Only ranges of the worksheet they were copied from are moved.
      if (!current || busyRef.current || data.sheetId !== current.id) return;
      const before = snapshotWorksheet(current);
      busyRef.current = true;
      setCellBusy(true);
      setCellError("");
      setHistoryError("");
      try {
        const result = await transferRange(
          workbookId,
          current.id,
          data.source,
          { start: target.start, end: target.end },
          data.mode,
        );
        applyWorkbook(result.workbook);
        recordOperation(before);
        const updated = result.workbook.sheets.find((entry) => entry.id === current.id);
        applySelection(sheetSelection(updated));
        setClipboardNotice("");
        // A cut moves the values away; the filled copy is gone with the operation.
        if (data.mode === "cut") applyClipboard(null);
      } catch (failure) {
        setCellError(failure instanceof Error ? failure.message : PASTE_FAILURE_MESSAGE);
      } finally {
        busyRef.current = false;
        setCellBusy(false);
      }
    },
    [workbookId],
  );

  /** Pastes external tab-separated text starting at `start`; the whole rectangle or nothing. */
  const pasteText = useCallback(
    async (text: string, start: string) => {
      const current = sheetRef.current;
      if (!current || busyRef.current) return;
      const before = snapshotWorksheet(current);
      externalTextRef.current = text;
      busyRef.current = true;
      setCellBusy(true);
      setCellError("");
      setHistoryError("");
      try {
        const result = await pasteCells(workbookId, current.id, start, text);
        applyWorkbook(result.workbook);
        recordOperation(before);
      } catch (failure) {
        setCellError(failure instanceof Error ? failure.message : PASTE_FAILURE_MESSAGE);
      } finally {
        busyRef.current = false;
        setCellBusy(false);
      }
    },
    [workbookId],
  );

  /** Ctrl+V on the grid: the copied range when the browser offers it, else external text. */
  const handlePasteText = useCallback(
    (text: string, start: string) => {
      const internal = clipboardRef.current;
      if (isRangeClipboardText(internal, text) && internal) {
        void moveRange(internal, { start, end: start });
        return;
      }
      if (text) void pasteText(text, start);
    },
    [moveRange, pasteText],
  );

  /** Reads the system clipboard for the toolbar and context-menu `Paste` commands. */
  async function readClipboardText(): Promise<{ text: string; failed: boolean }> {
    try {
      if (!navigator.clipboard?.readText) return { text: "", failed: true };
      return { text: (await navigator.clipboard.readText()) ?? "", failed: false };
    } catch {
      return { text: "", failed: true };
    }
  }

  const handlePasteButton = useCallback(async () => {
    if (busyRef.current) return;
    const internal = clipboardRef.current;
    if (internal) {
      void moveRange(internal, selectionRef.current);
      return;
    }
    const { text, failed } = await readClipboardText();
    const value = text || externalTextRef.current;
    if (!value) {
      setCellError(failed ? CLIPBOARD_FAILURE_MESSAGE : CLIPBOARD_EMPTY_MESSAGE);
      return;
    }
    void pasteText(value, selectionRef.current.start);
  }, [moveRange, pasteText]);

  const handlePasteCommand = useCallback(
    async (address: string) => {
      if (busyRef.current) return;
      const target = targetSelectionFor(address, selectionRef.current);
      const internal = clipboardRef.current;
      const { text, failed } = await readClipboardText();
      if (isRangeClipboardText(internal, text) && internal) {
        void moveRange(internal, target);
        return;
      }
      const value = text || externalTextRef.current;
      if (!value) {
        setCellError(failed ? CLIPBOARD_FAILURE_MESSAGE : CLIPBOARD_EMPTY_MESSAGE);
        return;
      }
      void pasteText(value, target.start);
    },
    [moveRange, pasteText],
  );

  // Keyboard shortcuts of the session: Ctrl/Cmd+Z undoes, Ctrl/Cmd+Y redoes (they work
  // wherever the focus is), Ctrl/Cmd+C and Ctrl/Cmd+X copy or cut the selected rectangle.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inField = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.defaultPrevented) return;
      const key = event.key.toLowerCase();
      if (key === "z" || key === "y") {
        // While text is still being typed the field keeps its own undo behaviour.
        if (editRef.current) return;
        event.preventDefault();
        void runHistoryStep(key === "z" ? "undo" : "redo");
        return;
      }
      if (inField) return;
      if (key === "c") {
        event.preventDefault();
        startRangeCopy("copy");
      } else if (key === "x") {
        event.preventDefault();
        startRangeCopy("cut");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runHistoryStep, startRangeCopy]);

  if (state === "loading") {
    return (
      <main>
        <h1>Workbook</h1>
        <p role="status">Loading workbook…</p>
        <p>
          <a href={makeHash("/")}>Back to workbooks</a>
        </p>
      </main>
    );
  }

  if (state === "error" || !workbook) {
    return (
      <main>
        <h1>Workbook unavailable</h1>
        <p role="alert" className="page-error">
          {error || "Workbook not found"}
        </p>
        <p>
          <a href={makeHash("/")}>Back to workbooks</a>
        </p>
      </main>
    );
  }

  const editing = edit && edit.address === selection.start ? edit : null;
  const formulaBarValue = editing ? editing.value : cellInput(sheet, selection.start);

  async function handleRename(name: string) {
    const result = await renameWorkbook(workbookId, name);
    applyWorkbook(result.workbook);
    setRenameOpen(false);
    renameButtonRef.current?.focus();
  }

  function handleSelectSheet(sheetId: string) {
    if (sheetId === activeSheetIdRef.current) return;
    const target = workbookRef.current?.sheets.find((entry) => entry.id === sheetId);
    const next = sheetSelection(target);
    activeSheetIdRef.current = sheetId;
    setActiveSheetId(sheetId);
    applyEdit(null);
    setCellError("");
    setStructureError("");
    // A copied range belongs to the worksheet it was taken from; switching drops it.
    applyClipboard(null);
    setClipboardNotice("");
    applySelection(next);
    void setActiveWorksheet(workbookId, sheetId)
      .then((result) => {
        const current = workbookRef.current;
        if (current) applyWorkbook({ ...current, activeSheetId: result.workbook.activeSheetId });
      })
      .catch(() => {
        /* Worksheet switching stays local; the stored state is retried on the next open. */
      });
  }

  /**
   * Follows the worksheet a pivot-table create just activated (REQ-5-3-1): the new pivot
   * worksheet becomes the visible one, with A1 selected, exactly like a tab switch.
   */
  function activateWorksheet(sheetId: string) {
    if (sheetId === activeSheetIdRef.current) return;
    activeSheetIdRef.current = sheetId;
    setActiveSheetId(sheetId);
    applyEdit(null);
    setCellError("");
    setStructureError("");
    applyClipboard(null);
    setClipboardNotice("");
    applySelection(DEFAULT_SELECTION);
  }

  /**
   * Follows the worksheet the server made active after a lifecycle change and restores its
   * last confirmed selection, so the grid, the formula bar and every per-worksheet pane show
   * the target worksheet instead of the previous one.
   */
  function followActiveWorksheet(next: WorkbookState) {
    const sheetId = next.activeSheetId;
    activeSheetIdRef.current = sheetId;
    setActiveSheetId(sheetId);
    applyEdit(null);
    setCellError("");
    setStructureError("");
    // A copied range belongs to the worksheet it was taken from.
    applyClipboard(null);
    setClipboardNotice("");
    applySelection(sheetSelection(next.sheets.find((entry) => entry.id === sheetId)));
  }

  async function handleAddWorksheet() {
    if (adding) return;
    setAdding(true);
    setSheetError("");
    try {
      const result = await addWorksheet(workbookId);
      applyWorkbook(result.workbook);
      activeSheetIdRef.current = result.workbook.activeSheetId;
      setActiveSheetId(result.workbook.activeSheetId);
      applyEdit(null);
      setCellError("");
      applySelection(DEFAULT_SELECTION);
    } catch (failure) {
      setSheetError(failure instanceof Error ? failure.message : "Unable to add worksheet");
    } finally {
      setAdding(false);
    }
  }

  /**
   * Runs one row/column structure change on the active worksheet. The server moves the
   * whole band atomically; on failure the grid keeps the pre-operation structure because
   * the workbook state is only replaced after a successful response.
   */
  async function handleStructureChange(operation: StructureOperation) {
    if (structureBusy || !sheet) return;
    const before = snapshotWorksheet(sheet);
    setStructureBusy(true);
    setStructureError("");
    try {
      const result =
        operation.axis === "row"
          ? await changeRowStructure(workbookId, sheet.id, operation.action, operation.index + 1)
          : await changeColumnStructure(
              workbookId,
              sheet.id,
              operation.action,
              operation.index + 1,
            );
      applyWorkbook(result.workbook);
      recordOperation(before);
      // The selection and the formula bar keep their coordinates, so both follow the
      // shifted data instead of jumping to another cell.
    } catch (failure) {
      setStructureError(failure instanceof Error ? failure.message : STRUCTURE_FAILURE_MESSAGE);
    } finally {
      setStructureBusy(false);
    }
  }

  /**
   * Writes one cell through the ordinary commit path (dropdown choice of a validated cell):
   * the server validates the write and recalculates dependents, and the history records the
   * state the worksheet had before it.
   * @returns the failure message, or null when the write succeeded.
   */
  async function writeCell(address: string, value: string): Promise<string | null> {
    const current = sheetRef.current;
    if (!current) return "Unable to update the cell";
    const before = snapshotWorksheet(current);
    try {
      const result = await updateCell(workbookId, current.id, address, value);
      applyWorkbook(result.workbook);
      recordOperation(before);
      return null;
    } catch (failure) {
      return failure instanceof Error ? failure.message : "Unable to update the cell";
    }
  }

  // ------------------------------------------------------------------ Data menu (REQ-5)

  function startEdit(address: string, value: string, origin: CellEdit["origin"]) {
    if (busyRef.current) return;
    setCellError("");
    applyEdit({ address, value, origin });
  }

  /**
   * Commits the uncommitted text of the current edit. The server validates the write and
   * recalculates every dependent formula; the grid and formula bar are only replaced by the
   * returned workbook, so a failed commit keeps the last successful content.
   */
  async function commitEdit(value: string) {
    const pending = editRef.current;
    const current = sheetRef.current;
    if (!pending || busyRef.current || !current) return;
    applyEdit(null);
    if (value === cellInput(current, pending.address)) return;
    const before = snapshotWorksheet(current);
    busyRef.current = true;
    setCellBusy(true);
    setCellError("");
    setHistoryError("");
    try {
      const result = await updateCell(workbookId, current.id, pending.address, value);
      applyWorkbook(result.workbook);
      recordOperation(before);
    } catch (failure) {
      setCellError(failure instanceof Error ? failure.message : "Unable to update the cell");
    } finally {
      busyRef.current = false;
      setCellBusy(false);
    }
  }

  function cancelEdit() {
    applyEdit(null);
    setCellError("");
  }

  /**
   * `Delete` in a worksheet tab menu (REQ-2-1-4). The last remaining worksheet is refused right
   * away - no confirmation dialog opens - with the contract message beside the tab bar.
   */
  function handleRequestDeleteWorksheet(target: WorksheetState) {
    setSheetError("");
    if ((workbookRef.current?.sheets.length ?? 0) <= 1) {
      setSheetError(WORKSHEET_LAST_REMAINING_MESSAGE);
      return;
    }
    if (deletingSheet) return;
    setDeleteSheetTarget(target);
  }

  /**
   * Confirms the deletion. The server removes the worksheet with its cells, formulas, filters,
   * validation rules and pivot state and answers with the worksheet that becomes active; a
   * refusal (a pivot table still reading the target, or any other failure) closes the dialog,
   * shows the message beside the tab bar and leaves the workbook exactly as it was.
   */
  async function handleConfirmDeleteWorksheet() {
    const target = deleteSheetTarget;
    if (!target || deletingSheet) return;
    setDeletingSheet(true);
    setSheetError("");
    try {
      const result = await deleteWorksheet(workbookId, target.id);
      applyWorkbook(result.workbook);
      followActiveWorksheet(result.workbook);
    } catch (failure) {
      setSheetError(failure instanceof Error ? failure.message : "Unable to delete worksheet");
    } finally {
      setDeleteSheetTarget(null);
      setDeletingSheet(false);
    }
  }

  async function handleRenameWorksheet(name: string) {
    const target = renameSheet;
    if (!target) return;
    const duplicate = (workbook?.sheets ?? []).some(
      (sheet) => sheet.id !== target.id && sheet.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) throw new Error("Worksheet name already exists");

    const result = await renameWorksheet(workbookId, target.id, name);
    applyWorkbook(result.workbook);
    setRenameSheet(null);
    queueMicrotask(() => document.getElementById(`worksheet-tab-${target.id}`)?.focus());
  }

  return (
    <main>
      <header className="editor-header">
        <div className="editor-header__title">
          <h1>{workbook.name}</h1>
          <Button ref={renameButtonRef} onClick={() => setRenameOpen(true)}>
            Rename workbook
          </Button>
        </div>
        <p className="editor-header__meta">Last updated: {formatUpdatedAt(workbook.updatedAt)}</p>
        <p className="editor-header__nav">
          <a href={makeHash("/")}>Back to workbooks</a>
        </p>
      </header>

      <EditorToolbar
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        busy={commandBusy}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={() => void handlePasteButton()}
      >
        <ExportCsvButton workbookName={workbook.name} sheet={sheet} />
        <DataMenu
          busy={commandBusy || dataTools.busy}
          onSortRange={dataTools.openSort}
          onCreateFilter={dataTools.createFilter}
          onClearFilter={dataTools.clearFilter}
          onDataValidation={dataTools.openValidation}
          onCreatePivotTable={dataTools.openPivotTable}
        />
      </EditorToolbar>

      {dataTools.error ? (
        <p role="alert" className="page-error data-error">
          {dataTools.error}
        </p>
      ) : null}

      {historyError ? (
        <p role="alert" className="page-error history-error">
          {historyError}
        </p>
      ) : null}

      {clipboardNotice ? (
        <p role="status" className="clipboard-status">
          {clipboardNotice}
        </p>
      ) : null}

      <WorksheetTabs
        sheets={workbook.sheets}
        activeSheetId={sheet?.id ?? ""}
        onSelect={handleSelectSheet}
        onAddWorksheet={() => void handleAddWorksheet()}
        onRenameWorksheet={(target) => {
          setSheetError("");
          setRenameSheet(target);
        }}
        onDeleteWorksheet={handleRequestDeleteWorksheet}
        adding={adding}
      />

      {sheetError ? (
        <p role="alert" className="page-error worksheet-tab-bar__error">
          {sheetError}
        </p>
      ) : null}

      {sheet ? (
        <div
          id={`worksheet-panel-${sheet.id}`}
          role="tabpanel"
          aria-labelledby={`worksheet-tab-${sheet.id}`}
          className="worksheet-panel"
        >
          {sheet.pivot ? (
            <PivotTableEditor
              key={sheet.id}
              workbook={workbook}
              sheet={sheet}
              busy={commandBusy || dataTools.busy}
              error={dataTools.pivotEditorError}
              onApply={dataTools.applyPivot}
              onRefresh={dataTools.refreshPivot}
            />
          ) : null}
          <FormField id="formula-bar" label="Formula bar">
            <input
              id="formula-bar"
              name="formula-bar"
              type="text"
              value={formulaBarValue}
              disabled={cellBusy}
              onChange={(event) => startEdit(selection.start, event.target.value, "formula")}
              onKeyDown={(event) => {
                if (!edit) return;
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitEdit(edit.value);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  cancelEdit();
                }
              }}
              onBlur={() => {
                if (edit && edit.origin === "formula") void commitEdit(edit.value);
              }}
            />
          </FormField>
          {cellError ? (
            <p role="alert" className="page-error cell-error">
              {cellError}
            </p>
          ) : null}
          {cellBusy ? (
            <p role="status" className="cell-status">
              {CELL_BUSY_MESSAGE}
            </p>
          ) : null}
          {structureError ? (
            <p role="alert" className="page-error structure-error">
              {structureError}
            </p>
          ) : null}
          {structureBusy ? (
            <p role="status" className="structure-status">
              {STRUCTURE_BUSY_MESSAGE}
            </p>
          ) : null}
          <WorksheetGrid
            sheet={sheet}
            selection={selection}
            edit={editing && editing.origin === "grid" ? editing : null}
            onSelect={selectCell}
            onSelectEnd={persistSelection}
            onStartEdit={(address, value) => startEdit(address, value, "grid")}
            onEditChange={(value) => {
              const current = editRef.current;
              if (current) applyEdit({ ...current, value });
            }}
            onEditCommit={(value) => void commitEdit(value)}
            onEditCancel={cancelEdit}
            onPasteText={handlePasteText}
            onPasteCommand={(address) => void handlePasteCommand(address)}
            onCopyRange={startRangeCopy}
            onOpenFilter={dataTools.openFilter}
            onSetCellValue={dataTools.setCellValue}
            onStructureChange={(operation) => void handleStructureChange(operation)}
            structureBusy={structureBusy}
            cellBusy={cellBusy || dataTools.busy}
          />
        </div>
      ) : null}

      {dataTools.sortOpen && sheet ? (
        <SortRangeDialog
          range={dataTools.selectedRange}
          columns={dataTools.sortColumns}
          hasHeader={dataTools.sortHasHeader}
          busy={dataTools.busy}
          error={dataTools.sortError}
          onSort={dataTools.applySort}
          onClose={dataTools.closeSort}
        />
      ) : null}

      {dataTools.filterColumn && sheet ? (
        <FilterDialog
          headerText={dataTools.filterHeader}
          values={dataTools.filterValues}
          current={dataTools.currentColumnFilter}
          busy={dataTools.busy}
          error={dataTools.filterError}
          onApply={dataTools.applyFilter}
          onClose={dataTools.closeFilter}
        />
      ) : null}

      {dataTools.validationOpen && sheet ? (
        <DataValidationDialog
          range={dataTools.selectedRange}
          rule={dataTools.activeRule}
          busy={dataTools.busy}
          error={dataTools.validationError}
          onSave={dataTools.saveValidation}
          onDelete={dataTools.deleteValidation}
          onClose={dataTools.closeValidation}
        />
      ) : null}

      {dataTools.pivotOpen && sheet ? (
        <CreatePivotTableDialog
          range={dataTools.selectedRange}
          busy={commandBusy || dataTools.busy}
          error={dataTools.pivotError}
          onCreate={dataTools.createPivotTable}
          onClose={dataTools.closePivotTable}
        />
      ) : null}

      {renameSheet ? (
        <RenameWorksheetDialog
          currentName={renameSheet.name}
          onClose={() => setRenameSheet(null)}
          onSave={handleRenameWorksheet}
        />
      ) : null}

      {deleteSheetTarget ? (
        <DeleteWorksheetDialog
          worksheetName={deleteSheetTarget.name}
          busy={deletingSheet}
          onConfirm={() => void handleConfirmDeleteWorksheet()}
          onClose={() => setDeleteSheetTarget(null)}
        />
      ) : null}

      {renameOpen ? (
        <RenameWorkbookDialog
          currentName={workbook.name}
          onClose={() => {
            setRenameOpen(false);
            renameButtonRef.current?.focus();
          }}
          onSave={handleRename}
        />
      ) : null}
    </main>
  );
}

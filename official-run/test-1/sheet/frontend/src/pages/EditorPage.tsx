import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getWorkbook,
  renameWorkbook,
  addSheet,
  renameSheet,
  modifyRows,
  modifyColumns,
  setCellValue,
  setSheetSelection,
  pasteCells,
  transferCells,
} from "../api";
import { formatLastUpdated } from "../format";
import { sheetToCsv, downloadCsv } from "../csv";
import { pasteStartCoord } from "../paste";
import { isInRegion } from "../coords";
import type { RowAction, ColumnAction } from "../structure";
import type { Sheet, Workbook, WorkbookSelection } from "../types";
import type { TransferOperation } from "../transfer";
import { computeDisplayCells } from "../formula";
import WorkbookGrid from "../components/WorkbookGrid";
import SheetTabs from "../components/SheetTabs";
import RenameDialog from "../components/RenameDialog";
import RenameSheetDialog from "../components/RenameSheetDialog";

function sheetSelectionOf(sheet: Sheet): WorkbookSelection {
  return (
    sheet.selection ?? { current: sheet.activeCell || "A1", end: sheet.activeCell || "A1" }
  );
}

export default function EditorPage({ id }: { id: string }) {
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const [selection, setSelection] = useState<WorkbookSelection>({ current: "A1", end: "A1" });
  const [selections, setSelections] = useState<Record<string, WorkbookSelection>>({});
  const [pendingValue, setPendingValue] = useState<string | null>(null);
  const [editingCoord, setEditingCoord] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [cellError, setCellError] = useState<string | null>(null);
  const [showRename, setShowRename] = useState(false);
  const [renameSheetFor, setRenameSheetFor] = useState<Sheet | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [gridError, setGridError] = useState<string | null>(null);
  // Synchronous mirror of editingCoord so blur/click sequencing never double-commits.
  const editingRef = useRef<string | null>(null);
  // Uncommitted formula-bar edit: the cell it targets and its text. Cleared after
  // the first commit/cancel so blur and click handlers never commit twice.
  const pendingRef = useRef<{ coord: string; value: string } | null>(null);
  // Last clipboard text captured from a native paste event (Ctrl+V); used as a
  // fallback when the context-menu Paste cannot read navigator.clipboard.
  const lastClipboardRef = useRef("");
  // Internal copy/cut clipboard (REQ-3-2-1): the source rectangle plus the
  // sheet it came from. Only transfers inside the same worksheet are supported.
  const clipboardRef = useRef<{
    operation: TransferOperation;
    sourceSheetId: string;
    source: { current: string; end: string };
  } | null>(null);
  // Latest copy/cut handler so the document-level keydown listener is fresh.
  const copyCutRef = useRef<(operation: TransferOperation) => void>(() => {});
  // Latest paste handler so the document-level listener never goes stale.
  const pasteHandlerRef = useRef<(text: string) => void>(() => {});

  useEffect(() => {
    let active = true;
    setWorkbook(null);
    setError(null);
    setGridError(null);
    setCellError(null);
    setPendingValue(null);
    pendingRef.current = null;
    setEditingCoord(null);
    editingRef.current = null;
    getWorkbook(id)
      .then(({ workbook: wb }) => {
        if (!active) return;
        setWorkbook(wb);
        setActiveSheetId(wb.activeSheetId);
        const map: Record<string, WorkbookSelection> = {};
        for (const sheet of wb.sheets) map[sheet.id] = sheetSelectionOf(sheet);
        setSelections(map);
        const sheet = wb.sheets.find((s) => s.id === wb.activeSheetId) || wb.sheets[0];
        setSelection(map[sheet.id]);
      })
      .catch((err: Error) => {
        if (active) {
          setWorkbook(null);
          setError(err.message || "Failed to load workbook");
        }
      });
    return () => {
      active = false;
    };
  }, [id, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const handleRename = useCallback(
    async (name: string) => {
      const { workbook: updated } = await renameWorkbook(workbook!.id, name);
      setWorkbook(updated);
    },
    [workbook],
  );

  const handleAddSheet = useCallback(async () => {
    setSheetError(null);
    try {
      const { workbook: updated } = await addSheet(workbook!.id);
      setWorkbook(updated);
      setActiveSheetId(updated.activeSheetId);
      setSelection({ current: "A1", end: "A1" });
      setSelections((m) => ({ ...m, [updated.activeSheetId]: { current: "A1", end: "A1" } }));
    } catch (err) {
      setSheetError(err instanceof Error ? err.message : "Failed to add a worksheet");
    }
  }, [workbook]);

  const handleRenameSheet = useCallback(
    async (name: string) => {
      if (!renameSheetFor) return;
      const { workbook: updated } = await renameSheet(workbook!.id, renameSheetFor.id, name);
      setWorkbook(updated);
    },
    [workbook, renameSheetFor],
  );

  const handleRowOperation = useCallback(
    async (row: number, action: RowAction) => {
      if (!workbook || !activeSheetId) return;
      const sheet = workbook.sheets.find((s) => s.id === activeSheetId) || workbook.sheets[0];
      if (!sheet) return;
      setGridError(null);
      try {
        const { workbook: updated } = await modifyRows(workbook.id, sheet.id, action, row);
        setWorkbook(updated);
        syncSelectionFrom(updated, activeSheetId);
      } catch (err) {
        setGridError(err instanceof Error ? err.message : "Row operation failed");
      }
    },
    [workbook, activeSheetId],
  );

  const handleColumnOperation = useCallback(
    async (column: number, action: ColumnAction) => {
      if (!workbook || !activeSheetId) return;
      const sheet = workbook.sheets.find((s) => s.id === activeSheetId) || workbook.sheets[0];
      if (!sheet) return;
      setGridError(null);
      try {
        const { workbook: updated } = await modifyColumns(workbook.id, sheet.id, action, column);
        setWorkbook(updated);
        syncSelectionFrom(updated, activeSheetId);
      } catch (err) {
        setGridError(err instanceof Error ? err.message : "Column operation failed");
      }
    },
    [workbook, activeSheetId],
  );

  function syncSelectionFrom(updated: Workbook, sheetId: string) {
    const sheet = updated.sheets.find((s) => s.id === sheetId);
    if (!sheet) return;
    const sel = sheetSelectionOf(sheet);
    setSelection(sel);
    setSelections((m) => ({ ...m, [sheetId]: sel }));
  }

  const handleInsertRowAbove = useCallback(
    (row: number) => void handleRowOperation(row, "insert-above"),
    [handleRowOperation],
  );
  const handleInsertRowBelow = useCallback(
    (row: number) => void handleRowOperation(row, "insert-below"),
    [handleRowOperation],
  );
  const handleDeleteRow = useCallback(
    (row: number) => void handleRowOperation(row, "delete"),
    [handleRowOperation],
  );
  const handleInsertColumnLeft = useCallback(
    (column: number) => void handleColumnOperation(column, "insert-left"),
    [handleColumnOperation],
  );
  const handleInsertColumnRight = useCallback(
    (column: number) => void handleColumnOperation(column, "insert-right"),
    [handleColumnOperation],
  );
  const handleDeleteColumn = useCallback(
    (column: number) => void handleColumnOperation(column, "delete"),
    [handleColumnOperation],
  );

  const commitCellValue = useCallback(
    async (coord: string, value: string) => {
      if (!workbook || !activeSheetId) return;
      const sheetId = activeSheetId;
      try {
        const { workbook: updated } = await setCellValue(workbook.id, sheetId, coord, value);
        setWorkbook(updated);
        setCellError(null);
      } catch (err) {
        setCellError(err instanceof Error ? err.message : "Failed to save the cell value");
      }
    },
    [workbook, activeSheetId],
  );

  /** Commit an uncommitted formula-bar edit for the cell it was typed into. */
  const commitPending = useCallback(async () => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setPendingValue(null);
    if (!pending || !workbook || !activeSheetId) return;
    await commitCellValue(pending.coord, pending.value);
  }, [workbook, activeSheetId, commitCellValue]);

  /** Copy or cut the currently selected rectangle (REQ-3-2-1). */
  const handleCopyCut = useCallback(
    (operation: TransferOperation) => {
      if (!workbook || !activeSheetId) return;
      setGridError(null);
      void commitPending();
      clipboardRef.current = {
        operation,
        sourceSheetId: activeSheetId,
        source: { current: selection.current, end: selection.end },
      };
    },
    [workbook, activeSheetId, selection, commitPending],
  );
  copyCutRef.current = handleCopyCut;

  /** Paste the internal copy/cut clipboard at the top-left of the selection. */
  const handleTransferPaste = useCallback(async () => {
    const clip = clipboardRef.current;
    if (!clip || !workbook || !activeSheetId) return;
    setGridError(null);
    await commitPending();
    const target = pasteStartCoord(selection);
    try {
      const { workbook: updated } = await transferCells(
        workbook.id,
        activeSheetId,
        clip.operation,
        clip.source.current,
        clip.source.end,
        target,
      );
      setWorkbook(updated);
      syncSelectionFrom(updated, activeSheetId);
      if (clip.operation === "cut") clipboardRef.current = null;
    } catch (err) {
      setGridError(err instanceof Error ? err.message : "Failed to paste");
    }
  }, [workbook, activeSheetId, selection, commitPending]);

  /** Paste text (external clipboard) at the top-left of the current selection (REQ-3-1-2). */
  const handlePasteText = useCallback(
    async (text: string) => {
      if (!workbook || !activeSheetId) return;
      setGridError(null);
      await commitPending();
      const start = pasteStartCoord(selection);
      try {
        const { workbook: updated } = await pasteCells(workbook.id, activeSheetId, start, text);
        setWorkbook(updated);
        syncSelectionFrom(updated, activeSheetId);
      } catch (err) {
        setGridError(err instanceof Error ? err.message : "Failed to paste");
      }
    },
    [workbook, activeSheetId, selection, commitPending],
  );

  /** Route a paste: an internal clipboard belonging to this sheet wins; otherwise paste text. */
  const handlePaste = useCallback(
    async (text: string) => {
      if (!workbook || !activeSheetId) return;
      if (clipboardRef.current && clipboardRef.current.sourceSheetId === activeSheetId) {
        await handleTransferPaste();
        return;
      }
      await handlePasteText(text);
    },
    [workbook, activeSheetId, handleTransferPaste, handlePasteText],
  );
  pasteHandlerRef.current = (text) => void handlePaste(text);

  /** Context-menu Paste: internal clipboard first, then the external clipboard. */
  const handleMenuPaste = useCallback(async () => {
    if (!workbook || !activeSheetId) return;
    if (clipboardRef.current && clipboardRef.current.sourceSheetId === activeSheetId) {
      await handleTransferPaste();
      return;
    }
    let text = lastClipboardRef.current;
    try {
      if (navigator.clipboard?.readText) {
        const read = await navigator.clipboard.readText();
        if (read !== "") text = read;
      }
    } catch {
      // clipboard read is unavailable/denied: fall back to the captured text
    }
    if (text === "") {
      setGridError("Clipboard is empty");
      return;
    }
    await handlePasteText(text);
  }, [workbook, activeSheetId, handleTransferPaste, handlePasteText]);

  // Ctrl+C / Ctrl+X copy/cut the selected rectangle; inside an input the
  // native clipboard behavior is preserved.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key !== "c" && key !== "x") return;
      const target = e.target as Element | null;
      if (
        target &&
        typeof target.closest === "function" &&
        target.closest("input, textarea, [contenteditable='true']")
      ) {
        return;
      }
      e.preventDefault();
      copyCutRef.current(key === "c" ? "copy" : "cut");
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Ctrl+V on the grid pastes the external clipboard content; pasting into an
  // input (formula bar / inline cell editor / dialogs) keeps native behavior.
  useEffect(() => {
    function onDocumentPaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      const text = e.clipboardData?.getData("text/plain");
      if (text == null) return;
      e.preventDefault();
      lastClipboardRef.current = text;
      pasteHandlerRef.current(text);
    }
    document.addEventListener("paste", onDocumentPaste);
    return () => document.removeEventListener("paste", onDocumentPaste);
  }, []);

  function handleFormulaBarChange(value: string) {
    setPendingValue(value);
    pendingRef.current = pendingRef.current
      ? { coord: pendingRef.current.coord, value }
      : { coord: selection.current, value };
  }

  function cancelPending() {
    pendingRef.current = null;
    setPendingValue(null);
  }

  function updateSelectionLocal(sheetId: string, sel: WorkbookSelection) {
    setSelection(sel);
    setSelections((m) => ({ ...m, [sheetId]: sel }));
  }

  async function persistSelection(sheetId: string, sel: WorkbookSelection) {
    if (!workbook) return;
    try {
      const { workbook: updated } = await setSheetSelection(workbook.id, sheetId, sel.current, sel.end);
      setWorkbook(updated);
    } catch {
      // Keep the local selection; the next successful selection re-persists it.
    }
  }

  function handleSelectCell(coord: string) {
    if (!workbook || !activeSheetId) return;
    const sheetId = activeSheetId;
    void commitPending();
    const sel = { current: coord, end: coord };
    updateSelectionLocal(sheetId, sel);
    void persistSelection(sheetId, sel);
  }

  function handleSelectionStart(coord: string) {
    if (!workbook || !activeSheetId) return;
    const sheetId = activeSheetId;
    void commitPending();
    const sel = { current: coord, end: coord };
    updateSelectionLocal(sheetId, sel);
  }

  function handleSelectionExtend(current: string, end: string) {
    if (!activeSheetId) return;
    updateSelectionLocal(activeSheetId, { current, end });
  }

  function handleSelectionCommit(current: string, end: string) {
    if (!workbook || !activeSheetId) return;
    const sel = { current, end };
    updateSelectionLocal(activeSheetId, sel);
    void persistSelection(activeSheetId, sel);
  }

  function startInlineEdit(coord: string) {
    if (!activeSheetId) return;
    const sheet = workbook!.sheets.find((s) => s.id === activeSheetId);
    editingRef.current = coord;
    setEditingCoord(coord);
    setEditValue(sheet?.cells[coord] ?? "");
    setCellError(null);
  }

  function commitInlineEdit() {
    const coord = editingRef.current;
    if (!coord) return;
    editingRef.current = null;
    setEditingCoord(null);
    void commitCellValue(coord, editValue);
  }

  function cancelInlineEdit() {
    editingRef.current = null;
    setEditingCoord(null);
  }

  function handleContextMenuCell(coord: string) {
    // Right-clicking inside the current selection keeps the complete rectangle
    // as the copy/cut source; right-clicking outside selects that cell.
    if (!workbook || !activeSheetId) return;
    if (!isInRegion(coord, selection.current, selection.end)) {
      handleSelectCell(coord);
    }
  }

  function handleSelectSheet(sheetId: string) {
    setActiveSheetId(sheetId);
    setSelection(selections[sheetId] ?? { current: "A1", end: "A1" });
    cancelPending();
    editingRef.current = null;
    setEditingCoord(null);
    setCellError(null);
  }

  const activeSheet = workbook
    ? workbook.sheets.find((s) => s.id === activeSheetId) || workbook.sheets[0]
    : null;
  const displayCells = useMemo(
    () => (activeSheet ? computeDisplayCells(activeSheet.cells) : {}),
    [workbook, activeSheet],
  );

  if (error) {
    return (
      <main className="editor">
        <p role="alert" className="error">
          {error}
        </p>
        <div className="toolbar">
          <button type="button" onClick={reload}>
            Try again
          </button>
          <a className="button-link" href="#/">
            Back to workbooks
          </a>
        </div>
      </main>
    );
  }

  if (!workbook || !activeSheet) {
    return (
      <main className="editor">
        <p className="status">Loading workbook…</p>
      </main>
    );
  }

  const selectedValue = activeSheet.cells[selection.current] ?? "";

  return (
    <main className="editor">
      <header className="editor-header">
        <div className="title-row">
          <h1>{workbook.name}</h1>
          <div className="toolbar">
            <button type="button" onClick={() => setShowRename(true)}>
              Rename workbook
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => downloadCsv(`${workbook.name}.csv`, sheetToCsv(activeSheet))}
            >
              Export CSV
            </button>
          </div>
        </div>
        <span className="updated">Last updated: {formatLastUpdated(workbook.updatedAt)}</span>
      </header>
      <SheetTabs
        sheets={workbook.sheets}
        activeSheetId={activeSheet.id}
        onSelect={handleSelectSheet}
        onAdd={handleAddSheet}
        onRename={(sheet) => setRenameSheetFor(sheet)}
      />
      {sheetError && (
        <p role="alert" className="error tab-error">
          {sheetError}
        </p>
      )}
      <div className="formula-bar">
        <label htmlFor="formula-bar-input">Formula bar</label>
        <input
          id="formula-bar-input"
          value={pendingValue ?? selectedValue}
          onChange={(e) => handleFormulaBarChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commitPending();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelPending();
            }
          }}
          onBlur={() => void commitPending()}
        />
      </div>
      {cellError && (
        <p role="alert" className="error cell-error">
          {cellError}
        </p>
      )}
      {gridError && (
        <p role="alert" className="error grid-error">
          {gridError}
        </p>
      )}
      <WorkbookGrid
        displayCells={displayCells}
        selection={selection}
        onSelectCell={handleSelectCell}
        onSelectRangeStart={handleSelectionStart}
        onSelectRangeExtend={handleSelectionExtend}
        onSelectRangeCommit={handleSelectionCommit}
        onEditCell={startInlineEdit}
        editingCoord={editingCoord}
        editValue={editValue}
        onEditChange={setEditValue}
        onEditCommit={commitInlineEdit}
        onEditCancel={cancelInlineEdit}
        dimensions={{ rows: activeSheet.rowCount ?? 0, columns: activeSheet.columnCount ?? 0 }}
        onInsertRowAbove={handleInsertRowAbove}
        onInsertRowBelow={handleInsertRowBelow}
        onDeleteRow={handleDeleteRow}
        onInsertColumnLeft={handleInsertColumnLeft}
        onInsertColumnRight={handleInsertColumnRight}
        onDeleteColumn={handleDeleteColumn}
        onContextMenuCell={handleContextMenuCell}
        onPaste={() => void handleMenuPaste()}
        onCopy={() => handleCopyCut("copy")}
        onCut={() => handleCopyCut("cut")}
      />
      {showRename && (
        <RenameDialog
          currentName={workbook.name}
          onSave={handleRename}
          onClose={() => setShowRename(false)}
        />
      )}
      {renameSheetFor && (
        <RenameSheetDialog
          currentName={renameSheetFor.name}
          onSave={handleRenameSheet}
          onClose={() => setRenameSheetFor(null)}
        />
      )}
    </main>
  );
}

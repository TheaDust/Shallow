import { useEffect, useRef, useState } from "react";

import { Button } from "../ui/Button";
import { Menu, type MenuItem } from "../ui/Menu";
import { WorksheetGrid, isEditableTarget, type CellEditState } from "../features/editor/WorksheetGrid";
import { WorksheetTabs } from "../features/editor/WorksheetTabs";
import { FormulaBar } from "../features/editor/FormulaBar";
import { RenameWorkbookDialog } from "../features/editor/RenameWorkbookDialog";
import { RenameWorksheetDialog } from "../features/editor/RenameWorksheetDialog";
import { DeleteWorksheetDialog } from "../features/editor/DeleteWorksheetDialog";
import { FilterDialog } from "../features/editor/FilterDialog";
import { SortRangeDialog } from "../features/editor/SortRangeDialog";
import { DataValidationDialog } from "../features/editor/DataValidationDialog";
import { CreatePivotDialog } from "../features/editor/CreatePivotDialog";
import { PivotTableEditor, type PivotFieldSelection } from "../features/editor/PivotTableEditor";
import { exportWorksheetCsv } from "../features/editor/exportCsv";
import { useWorkbookSession } from "../features/editor/useWorkbookSession";
import { cellCoordinate, currentCell, sameSelection, selectionBounds } from "../domain/grid";
import { evaluateCells } from "../domain/formula";
import {
  columnFilterOf,
  createFilterForSelection,
  distinctFilterValues,
  filterHeaderText,
  withColumnFilter,
} from "../domain/filter";
import { ruleCoveringBounds } from "../domain/validation";
import { clipboardTableText, hasClipboardTable, parseClipboardTable } from "../domain/paste";
import { errorMessage } from "../lib/workbooks-api";
import type {
  CellCoordinate,
  CellSelection,
  FilterColumn,
  RangeTransferMode,
  SortRangeSpec,
  ValidationRuleInput,
  Workbook,
  Worksheet,
  WorksheetStructureOperation,
} from "../domain/types";

export interface WorkbookEditorPageProps {
  workbookId: string;
}

/** Shown when deleting would leave the workbook without any worksheet. */
const WORKSHEET_LAST_REMAINING = "A workbook must contain at least one worksheet";

/** Shown when the browser refuses to hand over the clipboard text. */
const CLIPBOARD_UNAVAILABLE = "Unable to read the clipboard. Please allow clipboard access and try again.";

/** The range a copy or cut put aside, so a paste can transfer it in place. */
interface RangeClipboard {
  worksheetId: string;
  source: CellSelection;
  mode: RangeTransferMode;
}

/** Best-effort copy of the range text to the system clipboard. */
function writeSystemClipboard(worksheet: Worksheet, selection: CellSelection): void {
  try {
    const text = clipboardTableText(evaluateCells(worksheet.cells), selectionBounds(selection));
    void navigator.clipboard?.writeText?.(text)?.catch(() => undefined);
  } catch {
    // The in-app range marker is what the paste uses, so a refused clipboard is fine.
  }
}

/** True when the event happened inside an open dialog, which owns its own keys. */
function insideDialog(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element && typeof element.closest === "function" && element.closest('[role="dialog"]'));
}

/**
 * Editor page: owns the cell draft shared by the grid and the formula bar, the
 * in-app range clipboard behind the Copy/Cut/Paste commands and shortcuts, the
 * pending selection overlay and the Undo/Redo toolbar. Every write goes through
 * the session so the stored workbook stays the single authority.
 */
export function WorkbookEditorPage({ workbookId }: WorkbookEditorPageProps) {
  const {
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
  } = useWorkbookSession(workbookId);
  const [renaming, setRenaming] = useState(false);
  const [renamingWorksheetId, setRenamingWorksheetId] = useState<string | null>(null);
  const [deletingWorksheetId, setDeletingWorksheetId] = useState<string | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [addingWorksheet, setAddingWorksheet] = useState(false);
  const [structureBusy, setStructureBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [filterColumn, setFilterColumn] = useState<number | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const [createPivotOpen, setCreatePivotOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CellEditState | null>(null);
  const [pendingSelection, setPendingSelection] = useState<CellSelection | null>(null);
  const [clipboard, setClipboard] = useState<RangeClipboard | null>(null);
  const pasteRef = useRef<(text: string) => void>(() => {});
  const clipboardRef = useRef<RangeClipboard | null>(null);
  const pasteRangeRef = useRef<() => boolean>(() => false);
  const copyRef = useRef<() => void>(() => {});
  const cutRef = useRef<() => void>(() => {});
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  const editingSourceRef = useRef<CellEditState["source"] | null>(null);
  clipboardRef.current = clipboard;
  editingSourceRef.current = editing?.source ?? null;

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      // The formula bar and dialog fields keep their own paste behaviour.
      if (isEditableTarget(event.target)) return;
      // A range copied in this session wins over the system clipboard text.
      if (pasteRangeRef.current()) {
        event.preventDefault();
        return;
      }
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!text) return;
      event.preventDefault();
      pasteRef.current(text);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const editable = isEditableTarget(event.target);
      if (key === "z" || key === "y") {
        // The grid's inline editor and dialog fields keep their own text history.
        if (editable && (editingSourceRef.current === "grid" || insideDialog(event.target))) return;
        event.preventDefault();
        if (key === "z") undoRef.current();
        else redoRef.current();
        return;
      }
      if (event.shiftKey || editable) return;
      if (key === "c") {
        event.preventDefault();
        copyRef.current();
        return;
      }
      if (key === "x") {
        event.preventDefault();
        cutRef.current();
        return;
      }
      if (key === "v" && clipboardRef.current) {
        // Intercept only when this session holds a copied range; otherwise the
        // browser delivers the external clipboard through the paste event.
        event.preventDefault();
        pasteRangeRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  if (status === "loading") {
    return (
      <main>
        <p role="status">Loading workbook…</p>
      </main>
    );
  }

  if (status === "error" || !workbook) {
    return (
      <main>
        <h1>Workbook unavailable</h1>
        <p role="alert">{error}</p>
        <p><a href="#/">Home</a></p>
      </main>
    );
  }

  const activeWorksheet =
    workbook.worksheets.find((entry) => entry.id === workbook.activeWorksheetId) ?? workbook.worksheets[0];
  // A selection is shown immediately and stays visible until its save settles.
  const displayedWorksheet = pendingSelection
    ? { ...activeWorksheet, selection: pendingSelection }
    : activeWorksheet;
  const cell = currentCell(displayedWorksheet.selection);
  const cellKey = cellCoordinate(cell.row, cell.col);
  const draftForCell =
    editing && editing.row === cell.row && editing.col === cell.col ? editing.value : null;
  const formulaValue = draftForCell ?? displayedWorksheet.cells[cellKey] ?? "";
  const targetStart: CellCoordinate = (() => {
    const bounds = selectionBounds(displayedWorksheet.selection);
    return { row: bounds.minRow, col: bounds.minCol };
  })();
  // A pivot result worksheet carries the pivot whose cells it renders; the
  // source range for a new pivot is the block around the current selection.
  const activePivot =
    (workbook.pivots ?? []).find((entry) => entry.resultWorksheetId === activeWorksheet.id) ?? null;
  const pivotSource = activePivot
    ? workbook.worksheets.find((entry) => entry.id === activePivot.sourceWorksheetId) ?? null
    : null;
  const pivotSourceRange = createFilterForSelection(activeWorksheet, displayedWorksheet.selection).range;

  const settleSelection = (selection: CellSelection) => {
    setPendingSelection((current) => (current && sameSelection(current, selection) ? null : current));
  };

  const handleSelectRange = (selection: CellSelection) => {
    setActionError(null);
    setEditing(null);
    setPendingSelection(selection);
    void selectRange(activeWorksheet.id, selection)
      .catch((cause) => {
        setActionError(errorMessage(cause));
      })
      .finally(() => settleSelection(selection));
  };

  const writeDraft = (draft: CellEditState) => {
    setActionError(null);
    void writeCells(activeWorksheet.id, { row: draft.row, col: draft.col }, [[draft.value]]).catch((cause) =>
      setActionError(errorMessage(cause)),
    );
  };

  const handleBeginEdit = (row: number, col: number, seed?: string) => {
    setActionError(null);
    const raw = activeWorksheet.cells[cellCoordinate(row, col)] ?? "";
    setEditing({ row, col, value: seed ?? raw, source: "grid" });
  };

  const handleDraftChange = (value: string) => {
    setEditing((current) =>
      current ? { ...current, value } : { row: cell.row, col: cell.col, value, source: "formulaBar" },
    );
  };

  const handleCommitEdit = () => {
    const draft = editing;
    if (!draft) return;
    setEditing(null);
    if (draft.value === (activeWorksheet.cells[cellCoordinate(draft.row, draft.col)] ?? "")) return;
    writeDraft(draft);
  };

  const handleCancelEdit = () => {
    setEditing(null);
  };

  const handleClearCell = (row: number, col: number) => {
    setEditing(null);
    setActionError(null);
    void writeCells(activeWorksheet.id, { row, col }, [[""]]).catch((cause) =>
      setActionError(errorMessage(cause)),
    );
  };

  const pasteText = (text: string) => {
    const values = parseClipboardTable(text);
    if (!hasClipboardTable(values)) return;
    setActionError(null);
    void writeCells(activeWorksheet.id, targetStart, values).catch((cause) =>
      setActionError(errorMessage(cause)),
    );
  };
  pasteRef.current = pasteText;

  /** Moves the copied/cut range to the target cell; false when there is none. */
  const pasteRange = (): boolean => {
    const source = clipboardRef.current;
    if (!source || source.worksheetId !== activeWorksheet.id) return false;
    setActionError(null);
    setEditing(null);
    void transferRange(activeWorksheet.id, source.source, targetStart, source.mode)
      .then(() => {
        // A cut moves the cells once; a copy can be pasted again.
        if (source.mode === "cut") setClipboard(null);
      })
      .catch((cause) => setActionError(errorMessage(cause)));
    return true;
  };
  pasteRangeRef.current = pasteRange;

  const startRangeTransfer = (mode: RangeTransferMode) => {
    setActionError(null);
    setEditing(null);
    const selection = displayedWorksheet.selection;
    setClipboard({ worksheetId: activeWorksheet.id, source: selection, mode });
    writeSystemClipboard(activeWorksheet, selection);
  };

  const handleCopy = () => startRangeTransfer("copy");
  const handleCut = () => startRangeTransfer("cut");
  copyRef.current = handleCopy;
  cutRef.current = handleCut;

  const handlePasteCommand = () => {
    setActionError(null);
    if (pasteRange()) return;
    const clipboardApi = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboardApi?.readText) {
      setActionError(CLIPBOARD_UNAVAILABLE);
      return;
    }
    clipboardApi.readText().then(
      (text) => pasteRef.current(text),
      () => setActionError(CLIPBOARD_UNAVAILABLE),
    );
  };

  /** Steps the session history; the buttons and shortcuts share this path. */
  const runHistory = async (action: "undo" | "redo") => {
    if (historyBusy) return;
    if (action === "undo" ? !history.canUndo : !history.canRedo) return;
    setActionError(null);
    setEditing(null);
    setPendingSelection(null);
    setHistoryBusy(true);
    try {
      await (action === "undo" ? undo() : redo());
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setHistoryBusy(false);
    }
  };

  const handleUndo = () => void runHistory("undo");
  const handleRedo = () => void runHistory("redo");
  undoRef.current = handleUndo;
  redoRef.current = handleRedo;

  const handleExport = () => {
    setActionError(null);
    try {
      exportWorksheetCsv(workbook, activeWorksheet);
    } catch (cause) {
      setActionError(errorMessage(cause));
    }
  };

  /** Creates a filter over the selected region (or the block around one cell). */
  const handleCreateFilter = () => {
    setActionError(null);
    setEditing(null);
    const filter = createFilterForSelection(activeWorksheet, displayedWorksheet.selection);
    void setFilter(activeWorksheet.id, filter).catch((cause) => setActionError(errorMessage(cause)));
  };

  /** Restores every source record: the worksheet itself was never changed. */
  const handleClearFilter = () => {
    setActionError(null);
    setEditing(null);
    setFilterColumn(null);
    if (!activeWorksheet.filter) return;
    void setFilter(activeWorksheet.id, null).catch((cause) => setActionError(errorMessage(cause)));
  };

  /** Stores the condition/value filter of one column, keeping the other columns. */
  const handleApplyColumnFilter = async (column: FilterColumn) => {
    const base =
      activeWorksheet.filter ??
      createFilterForSelection(activeWorksheet, displayedWorksheet.selection);
    await setFilter(activeWorksheet.id, withColumnFilter(base, column.col, column));
  };

  const handleSaveValidation = async (rule: ValidationRuleInput) => {
    await saveValidation(activeWorksheet.id, rule);
  };

  const handleDeleteValidation = async (ruleId: string) => {
    await deleteValidation(activeWorksheet.id, ruleId);
  };

  const handleDropdownSelect = (row: number, col: number, value: string) => {
    setActionError(null);
    void writeCells(activeWorksheet.id, { row, col }, [[value]]).catch((cause) =>
      setActionError(errorMessage(cause)),
    );
  };

  /**
   * Reorders the records of the selected range. A rejected sort rejects this
   * promise too, so the dialog keeps its message and the grid keeps its order.
   */
  const handleSortRange = async (spec: SortRangeSpec) => {
    setEditing(null);
    await sortRange(activeWorksheet.id, spec);
  };

  const dataItems: MenuItem[] = [
    {
      id: "sort-range",
      label: "Sort range",
      onSelect: () => {
        setActionError(null);
        setEditing(null);
        setSortOpen(true);
      },
    },
    { id: "create-filter", label: "Create filter", onSelect: handleCreateFilter },
    { id: "clear-filter", label: "Clear filter", onSelect: handleClearFilter },
    {
      id: "data-validation",
      label: "Data validation",
      onSelect: () => {
        setActionError(null);
        setEditing(null);
        setValidationOpen(true);
      },
    },
    {
      id: "create-pivot-table",
      label: "Create pivot table",
      onSelect: () => {
        setActionError(null);
        setEditing(null);
        setCreatePivotOpen(true);
      },
    },
  ];

  /** Creates the pivot result worksheet over the selected range. */
  const handleCreatePivot = async () => {
    setEditing(null);
    await createPivot(activeWorksheet.id, pivotSourceRange);
  };

  const handleApplyPivot = async (selection: PivotFieldSelection) => {
    if (!activePivot) return;
    await applyPivot(activePivot.id, selection);
  };

  const handleRefreshPivot = async () => {
    if (!activePivot) return;
    await refreshPivot(activePivot.id);
  };

  const handleSelectWorksheet = (worksheetId: string) => {
    setActionError(null);
    setEditing(null);
    setPendingSelection(null);
    void activateWorksheet(worksheetId).catch((cause) => setActionError(errorMessage(cause)));
  };

  const handleAddWorksheet = async () => {
    if (addingWorksheet) return;
    setActionError(null);
    setEditing(null);
    setAddingWorksheet(true);
    try {
      await addWorksheet();
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setAddingWorksheet(false);
    }
  };

  /**
   * Starts the tab menu's `Delete` command: the last remaining worksheet is
   * refused outright (no confirmation dialog), any other target opens the
   * "Delete worksheet" confirmation.
   */
  const handleRequestDeleteWorksheet = (worksheetId: string) => {
    setActionError(null);
    setEditing(null);
    if (workbook.worksheets.length <= 1) {
      setActionError(WORKSHEET_LAST_REMAINING);
      return;
    }
    setDeletingWorksheetId(worksheetId);
  };

  /**
   * Confirms the deletion. The store rejects a pivot-table source worksheet
   * with `Please delete or rebuild dependent pivot tables first`; either way
   * the dialog closes and a rejection is shown without touching the workbook.
   */
  const handleConfirmDeleteWorksheet = async () => {
    const target = deletingWorksheetId
      ? workbook.worksheets.find((entry) => entry.id === deletingWorksheetId) ?? null
      : null;
    if (!target || deletingBusy) return;
    setDeletingBusy(true);
    try {
      await deleteWorksheet(target.id);
      setDeletingWorksheetId(null);
    } catch (cause) {
      setDeletingWorksheetId(null);
      setActionError(errorMessage(cause));
    } finally {
      setDeletingBusy(false);
    }
  };

  const handleStructureOperation = async (operation: WorksheetStructureOperation, index: number) => {
    if (structureBusy) return;
    setActionError(null);
    setEditing(null);
    setStructureBusy(true);
    try {
      await structureOperation(activeWorksheet.id, operation, index);
    } catch (cause) {
      setActionError(errorMessage(cause));
    } finally {
      setStructureBusy(false);
    }
  };

  const renamingWorksheet = renamingWorksheetId
    ? workbook.worksheets.find((entry) => entry.id === renamingWorksheetId) ?? null
    : null;
  const deletingWorksheet = deletingWorksheetId
    ? workbook.worksheets.find((entry) => entry.id === deletingWorksheetId) ?? null
    : null;

  return (
    <main>
      <header className="editor-header">
        <a className="editor-header__home" href="#/">Home</a>
        <div className="editor-header__title">
          <h1>{workbook.name}</h1>
          <div role="toolbar" aria-label="Workbook toolbar" className="editor-toolbar">
            <Button onClick={handleUndo} disabled={!history.canUndo || historyBusy}>Undo</Button>
            <Button onClick={handleRedo} disabled={!history.canRedo || historyBusy}>Redo</Button>
            <Button onClick={() => setRenaming(true)}>Rename workbook</Button>
            <Button onClick={handleExport}>Export CSV</Button>
            <Menu triggerLabel="Data" menuLabel="Data" items={dataItems} />
          </div>
        </div>
        <p className="editor-header__meta">Last updated: {workbook.updatedAt}</p>
      </header>
      {actionError ? <p className="editor-error" role="alert">{actionError}</p> : null}
      <FormulaBar
        value={formulaValue}
        onChange={handleDraftChange}
        onCommit={handleCommitEdit}
        onCancel={handleCancelEdit}
      />
      <WorksheetTabs
        worksheets={workbook.worksheets}
        activeId={activeWorksheet.id}
        addBusy={addingWorksheet}
        onSelect={handleSelectWorksheet}
        onAddWorksheet={() => void handleAddWorksheet()}
        onRenameWorksheet={setRenamingWorksheetId}
        onDeleteWorksheet={handleRequestDeleteWorksheet}
      />
      <div
        id={`worksheet-panel-${activeWorksheet.id}`}
        role="tabpanel"
        aria-labelledby={`worksheet-tab-${activeWorksheet.id}`}
        className="worksheet-panel"
      >
        {activePivot && pivotSource ? (
          <PivotTableEditor
            key={activePivot.id}
            pivot={activePivot}
            sourceWorksheet={pivotSource}
            onApply={handleApplyPivot}
            onRefresh={handleRefreshPivot}
          />
        ) : null}
        <WorksheetGrid
          worksheet={displayedWorksheet}
          editing={editing}
          onSelectRange={handleSelectRange}
          onBeginEdit={handleBeginEdit}
          onDraftChange={handleDraftChange}
          onCommitEdit={handleCommitEdit}
          onCancelEdit={handleCancelEdit}
          onClearCell={handleClearCell}
          onCopy={handleCopy}
          onCut={handleCut}
          onPaste={handlePasteCommand}
          onStructureOperation={(operation, index) => void handleStructureOperation(operation, index)}
          onFilterColumn={setFilterColumn}
          onDropdownSelect={handleDropdownSelect}
        />
      </div>
      <RenameWorkbookDialog
        open={renaming}
        currentName={workbook.name}
        onClose={() => setRenaming(false)}
        onSave={rename}
      />
      {renamingWorksheet ? (
        <RenameWorksheetDialog
          open
          currentName={renamingWorksheet.name}
          otherNames={workbook.worksheets
            .filter((entry) => entry.id !== renamingWorksheet.id)
            .map((entry) => entry.name)}
          onClose={() => setRenamingWorksheetId(null)}
          onSave={(name) => renameWorksheet(renamingWorksheet.id, name)}
        />
      ) : null}
      <DeleteWorksheetDialog
        open={deletingWorksheet !== null}
        worksheetName={deletingWorksheet?.name ?? ""}
        busy={deletingBusy}
        onClose={() => setDeletingWorksheetId(null)}
        onConfirm={() => void handleConfirmDeleteWorksheet()}
      />
      {filterColumn !== null && activeWorksheet.filter ? (
        <FilterDialog
          col={filterColumn}
          header={filterHeaderText(activeWorksheet, activeWorksheet.filter, filterColumn)}
          values={distinctFilterValues(activeWorksheet, activeWorksheet.filter, filterColumn)}
          initial={columnFilterOf(activeWorksheet.filter, filterColumn)}
          onClose={() => setFilterColumn(null)}
          onApply={handleApplyColumnFilter}
        />
      ) : null}
      {sortOpen ? (
        <SortRangeDialog
          worksheet={displayedWorksheet}
          range={selectionBounds(displayedWorksheet.selection)}
          onClose={() => setSortOpen(false)}
          onSort={handleSortRange}
        />
      ) : null}
      {validationOpen ? (
        <DataValidationDialog
          range={selectionBounds(displayedWorksheet.selection)}
          existing={ruleCoveringBounds(
            activeWorksheet.validations,
            selectionBounds(displayedWorksheet.selection),
          )}
          onClose={() => setValidationOpen(false)}
          onSave={handleSaveValidation}
          onDelete={handleDeleteValidation}
        />
      ) : null}
      {createPivotOpen ? (
        <CreatePivotDialog
          range={pivotSourceRange}
          onClose={() => setCreatePivotOpen(false)}
          onCreate={handleCreatePivot}
        />
      ) : null}
    </main>
  );
}

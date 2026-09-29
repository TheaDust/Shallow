import { useCallback, useEffect, useRef, useState } from "react";

import { Button, Menu, type MenuItem } from "../../ui";
import { makeHash } from "../../lib/hash-route";
import {
  addWorksheet as requestAddWorksheet,
  applyStructureCommand,
  errorMessage,
  exportWorksheetCsvUrl,
  redoWorkbook,
  setCells,
  setFilter as requestFilter,
  setSelection as requestSelection,
  setActiveWorksheet,
  transferRange,
  undoWorkbook,
} from "./api";
import { DataValidationDialog } from "./DataValidationDialog";
import { startDownload } from "./download";
import { filterRegionFor, ruleForRegion } from "./filtering";
import { FilterDialog } from "./FilterDialog";
import { FormulaBar } from "./FormulaBar";
import { formatLastUpdated } from "./format";
import {
  CLIPBOARD_UNAVAILABLE_MESSAGE,
  EMPTY_CLIPBOARD_MESSAGE,
  isFormControl,
  parseClipboardTable,
  tableToCellUpdates,
  writeClipboardText,
} from "./gridEditing";
import { rangeToText, selectionRange, type RangeClipboard } from "./rangeTransfer";
import { RenameWorkbookForm } from "./RenameWorkbookForm";
import { RenameWorksheetDialog } from "./RenameWorksheetDialog";
import { selectionFromWorksheet, selectionStart, type CellSelection } from "./selection";
import type { StructureAxis, StructureOperation } from "./structure";
import type { WorkbookData } from "./types";
import { WorksheetGrid } from "./WorksheetGrid";
import { WorksheetTabs } from "./WorksheetTabs";

export interface WorkbookEditorViewProps {
  workbook: WorkbookData;
  onWorkbookChange(workbook: WorkbookData): void;
}

export function WorkbookEditorView({ workbook, onWorkbookChange }: WorkbookEditorViewProps) {
  const activeWorksheet = workbook.worksheets.find((sheet) => sheet.id === workbook.activeWorksheetId)
    ?? workbook.worksheets[0];
  const [selection, setSelection] = useState<CellSelection>(() => selectionFromWorksheet(activeWorksheet));
  const [notice, setNotice] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renamingWorksheetId, setRenamingWorksheetId] = useState<string | null>(null);
  const [addingWorksheet, setAddingWorksheet] = useState(false);
  const [structureBusy, setStructureBusy] = useState(false);
  const [cellBusy, setCellBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  /** Range copied or cut in the active worksheet, waiting for a paste target. */
  const [clipboard, setClipboard] = useState<RangeClipboard | null>(null);
  /** Bumped when a write fails so the Formula bar restores the last successful text. */
  const [formulaReset, setFormulaReset] = useState(0);
  /** Last selection the server accepted, restored when a persistence call fails. */
  const persistedSelectionRef = useRef<CellSelection>(selection);
  /** One write at a time: a second edit, transfer or undo is ignored while one runs. */
  const busyRef = useRef(false);
  /** Open filter dialog of one header column, named by its header text. */
  const [filterColumn, setFilterColumn] = useState<{ column: string; headerText: string } | null>(null);
  /** Target range of the "Data validation" dialog, or null while it is closed. */
  const [validationRange, setValidationRange] = useState<{ start: string; end: string } | null>(null);
  const [dataBusy, setDataBusy] = useState(false);

  const worksheetToRename = renamingWorksheetId
    ? workbook.worksheets.find((sheet) => sheet.id === renamingWorksheetId) ?? null
    : null;

  useEffect(() => {
    const stored = selectionFromWorksheet(activeWorksheet);
    setSelection(stored);
    persistedSelectionRef.current = stored;
  }, [activeWorksheet.id]);

  const selectWorksheet = useCallback(
    async (worksheetId: string) => {
      if (worksheetId === workbook.activeWorksheetId) return;
      const previous = workbook;
      onWorkbookChange({ ...workbook, activeWorksheetId: worksheetId });
      setNotice(null);
      try {
        const result = await setActiveWorksheet(workbook.id, worksheetId);
        onWorkbookChange(result.workbook);
      } catch (error) {
        onWorkbookChange(previous);
        setNotice(errorMessage(error));
      }
    },
    [onWorkbookChange, workbook],
  );

  const handleAddWorksheet = useCallback(async () => {
    if (addingWorksheet) return;
    setNotice(null);
    setAddingWorksheet(true);
    try {
      const result = await requestAddWorksheet(workbook.id);
      onWorkbookChange(result.workbook);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setAddingWorksheet(false);
    }
  }, [addingWorksheet, onWorkbookChange, workbook.id]);

  /**
   * A selection is applied locally at once and stored with the worksheet; a
   * rejected call restores the last accepted rectangle so the grid never keeps
   * a selection the server did not save.
   */
  const handleSelectionChange = useCallback(
    (next: CellSelection, persist: boolean) => {
      setSelection(next);
      if (!persist) return;
      void requestSelection(workbook.id, activeWorksheet.id, next)
        .then((result) => {
          persistedSelectionRef.current = next;
          onWorkbookChange(result.workbook);
        })
        .catch((error: unknown) => {
          setSelection(persistedSelectionRef.current);
          setNotice(errorMessage(error));
        });
    },
    [activeWorksheet.id, onWorkbookChange, workbook.id],
  );

  /**
   * One commit writes every given cell through the server. The grid and the
   * formula bar only change from the answer, so a rejected commit keeps the
   * last successful values and results.
   */
  const commitCells = useCallback(
    async (updates: Record<string, string>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setCellBusy(true);
      setNotice(null);
      try {
        const result = await setCells(workbook.id, activeWorksheet.id, updates);
        onWorkbookChange(result.workbook);
      } catch (error) {
        setNotice(errorMessage(error));
        setFormulaReset((value) => value + 1);
      } finally {
        busyRef.current = false;
        setCellBusy(false);
      }
    },
    [activeWorksheet.id, onWorkbookChange, workbook.id],
  );

  const handleCommitEdit = useCallback(
    (address: string, text: string) => {
      void commitCells({ [address]: text });
    },
    [commitCells],
  );

  /** Remembers the selected rectangle; the source keeps its values until a paste. */
  const handleCopy = useCallback(() => {
    if (busyRef.current) return;
    const range = selectionRange(selection);
    setNotice(null);
    setClipboard({ worksheetId: activeWorksheet.id, mode: "copy", range });
    writeClipboardText(rangeToText(activeWorksheet.cells, range));
  }, [activeWorksheet.cells, activeWorksheet.id, selection]);

  /** Remembers the selected rectangle as a move: the source is cleared by the paste. */
  const handleCut = useCallback(() => {
    if (busyRef.current) return;
    const range = selectionRange(selection);
    setNotice(null);
    setClipboard({ worksheetId: activeWorksheet.id, mode: "cut", range });
    writeClipboardText(rangeToText(activeWorksheet.cells, range));
  }, [activeWorksheet.cells, activeWorksheet.id, selection]);

  /**
   * Places a remembered rectangle at the top-left corner of `target` through
   * the server, which writes the target cells and a cleared cut source in one
   * atomic request: a rejected transfer keeps the source, the target and every
   * dependent formula as they were.
   */
  const runRangeTransfer = useCallback(
    async (pending: RangeClipboard, target: CellSelection) => {
      busyRef.current = true;
      setCellBusy(true);
      setNotice(null);
      try {
        const result = await transferRange(workbook.id, activeWorksheet.id, {
          mode: pending.mode,
          source: pending.range,
          target: selectionRange(target),
        });
        // A cut moved the data: the remembered source is used up.
        if (pending.mode === "cut") setClipboard(null);
        onWorkbookChange(result.workbook);
      } catch (error) {
        setNotice(errorMessage(error));
        setFormulaReset((value) => value + 1);
      } finally {
        busyRef.current = false;
        setCellBusy(false);
      }
    },
    [activeWorksheet.id, onWorkbookChange, workbook.id],
  );

  /**
   * Starts a paste of the remembered range when one belongs to the active
   * worksheet; returns false so the caller can fall back to clipboard text.
   */
  const startRangeTransfer = useCallback(
    (target: CellSelection): boolean => {
      if (!clipboard || clipboard.worksheetId !== activeWorksheet.id || busyRef.current) return false;
      void runRangeTransfer(clipboard, target);
      return true;
    },
    [activeWorksheet.id, clipboard, runRangeTransfer],
  );

  /**
   * Pasted text either places the remembered range (a copy or cut of this
   * worksheet is pending) or applies the external clipboard as a rectangle
   * starting at the selection.
   */
  const handlePasteText = useCallback(
    (text: string) => {
      if (startRangeTransfer(selection)) return;
      const table = parseClipboardTable(text);
      if (table.length === 0) {
        setNotice(EMPTY_CLIPBOARD_MESSAGE);
        return;
      }
      const updates = tableToCellUpdates(selectionStart(selection), table);
      if (!updates) {
        setNotice(EMPTY_CLIPBOARD_MESSAGE);
        return;
      }
      void commitCells(updates);
    },
    [commitCells, selection, startRangeTransfer],
  );

  const handlePasteRequest = useCallback(() => {
    if (startRangeTransfer(selection)) return;
    const clipboardApi = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboardApi || typeof clipboardApi.readText !== "function") {
      setNotice(CLIPBOARD_UNAVAILABLE_MESSAGE);
      return;
    }
    clipboardApi.readText().then(
      (text) => handlePasteText(text),
      () => setNotice(CLIPBOARD_UNAVAILABLE_MESSAGE),
    );
  }, [handlePasteText, selection, startRangeTransfer]);

  /**
   * "Create filter" stores the data region the filter works on: the selected
   * rectangle when it spans more than one cell, otherwise the data region
   * around the current cell. The filter starts without column entries, so every
   * record stays visible until a header filter applies a value or a condition.
   */
  const handleCreateFilter = useCallback(async () => {
    if (busyRef.current) return;
    const region = filterRegionFor(selection, activeWorksheet.cells);
    if (!region) {
      setNotice("Select a data range with a header row to create a filter.");
      return;
    }
    busyRef.current = true;
    setDataBusy(true);
    setNotice(null);
    try {
      const result = await requestFilter(workbook.id, activeWorksheet.id, { range: region, columns: {} });
      onWorkbookChange(result.workbook);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      busyRef.current = false;
      setDataBusy(false);
    }
  }, [activeWorksheet.cells, activeWorksheet.id, onWorkbookChange, selection, workbook.id]);

  /** "Clear filter" restores every source record of the region untouched. */
  const handleClearFilter = useCallback(async () => {
    if (busyRef.current || !activeWorksheet.filter) return;
    busyRef.current = true;
    setDataBusy(true);
    setNotice(null);
    try {
      const result = await requestFilter(workbook.id, activeWorksheet.id, null);
      onWorkbookChange(result.workbook);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      busyRef.current = false;
      setDataBusy(false);
    }
  }, [activeWorksheet.filter, activeWorksheet.id, onWorkbookChange, workbook.id]);

  /** "Data validation" writes a rule for the rectangle selected in the grid. */
  const handleOpenValidation = useCallback(() => {
    setNotice(null);
    setValidationRange(selectionRange(selection));
  }, [selection]);

  /**
   * Row/column insertions and deletions go through the server, which shifts the
   * stored data and formulas in one write; the grid only changes once the
   * answer arrives, so a rejected operation keeps the previous structure.
   */
  const applyStructure = useCallback(
    async (axis: StructureAxis, operation: StructureOperation, index: number) => {
      if (busyRef.current) return;
      setNotice(null);
      busyRef.current = true;
      setStructureBusy(true);
      try {
        const result = await applyStructureCommand(workbook.id, activeWorksheet.id, axis, operation, index);
        onWorkbookChange(result.workbook);
      } catch (error) {
        setNotice(errorMessage(error));
      } finally {
        busyRef.current = false;
        setStructureBusy(false);
      }
    },
    [activeWorksheet.id, onWorkbookChange, workbook.id],
  );

  /**
   * Undo and redo ask the server for the stored state of the step before or
   * after the last operation; the grid, the formula bar and the calculated
   * results all change from that answer, which is persisted like any write.
   */
  const applyHistory = useCallback(
    async (direction: "undo" | "redo") => {
      if (busyRef.current) return;
      if (direction === "undo" ? !workbook.canUndo : !workbook.canRedo) return;
      setNotice(null);
      busyRef.current = true;
      setHistoryBusy(true);
      try {
        const result = direction === "undo"
          ? await undoWorkbook(workbook.id)
          : await redoWorkbook(workbook.id);
        onWorkbookChange(result.workbook);
      } catch (error) {
        setNotice(errorMessage(error));
      } finally {
        busyRef.current = false;
        setHistoryBusy(false);
      }
    },
    [onWorkbookChange, workbook.canRedo, workbook.canUndo, workbook.id],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        void applyHistory("undo");
        return;
      }
      if (key === "y") {
        event.preventDefault();
        void applyHistory("redo");
        return;
      }
      // Inside a text box the browser keeps its own copy/cut behaviour.
      if (isFormControl(event.target)) return;
      if (key === "c") {
        event.preventDefault();
        handleCopy();
      } else if (key === "x") {
        event.preventDefault();
        handleCut();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [applyHistory, handleCopy, handleCut]);

  const busy = cellBusy || historyBusy || dataBusy;
  const activeCellValue = activeWorksheet.cells[selection.anchor] ?? "";
  const copiedRange = clipboard && clipboard.worksheetId === activeWorksheet.id ? clipboard.range : null;

  /** Commands of the "Data" menu of the editor toolbar. */
  const dataMenuItems: MenuItem[] = [
    { id: "create-filter", label: "Create filter", onSelect: () => void handleCreateFilter() },
    { id: "clear-filter", label: "Clear filter", onSelect: () => void handleClearFilter() },
    { id: "data-validation", label: "Data validation", onSelect: handleOpenValidation },
  ];

  return (
    <main className="editor">
      <header className="editor__header">
        <a className="editor__home" href={makeHash("/")}>
          All workbooks
        </a>
        <div className="editor__titlebar">
          <h1 className="editor__title">{workbook.name}</h1>
          {renaming ? null : (
            <Button onClick={() => { setNotice(null); setRenaming(true); }}>Rename workbook</Button>
          )}
        </div>
        <p className="editor__meta">Last updated: {formatLastUpdated(workbook.updatedAt)}</p>
        {renaming ? (
          <RenameWorkbookForm
            workbook={workbook}
            onRenamed={(renamed) => {
              onWorkbookChange(renamed);
              setRenaming(false);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : null}
      </header>
      <div className="editor__toolbar">
        <Button
          onClick={() => void applyHistory("undo")}
          disabled={busy || !workbook.canUndo}
        >
          Undo
        </Button>
        <Button
          onClick={() => void applyHistory("redo")}
          disabled={busy || !workbook.canRedo}
        >
          Redo
        </Button>
        <Button onClick={() => startDownload(exportWorksheetCsvUrl(workbook.id, activeWorksheet.id))}>
          Export CSV
        </Button>
        <Menu
          triggerLabel="Data"
          menuLabel="Data"
          items={dataMenuItems}
        />
      </div>
      {notice ? (
        <p role="alert" className="form-error">
          {notice}
        </p>
      ) : null}
      <WorksheetTabs
        worksheets={workbook.worksheets}
        activeId={activeWorksheet.id}
        onChange={(worksheetId) => void selectWorksheet(worksheetId)}
        onAdd={() => void handleAddWorksheet()}
        onRename={(worksheetId) => {
          setNotice(null);
          setRenamingWorksheetId(worksheetId);
        }}
        addDisabled={addingWorksheet}
      >
        <FormulaBar
          key={activeWorksheet.id}
          cellAddress={selection.anchor}
          value={activeCellValue}
          disabled={busy}
          revision={formulaReset}
          onCommit={handleCommitEdit}
        />
        <WorksheetGrid
          cells={activeWorksheet.cells}
          values={activeWorksheet.values}
          selection={selection}
          busy={busy}
          copiedRange={copiedRange}
          filter={activeWorksheet.filter ?? null}
          hiddenRows={activeWorksheet.hiddenRows}
          validations={activeWorksheet.validations}
          onSelectionChange={handleSelectionChange}
          onCommitEdit={handleCommitEdit}
          onPasteText={handlePasteText}
          onPasteRequest={handlePasteRequest}
          onCopyRequest={handleCopy}
          onCutRequest={handleCut}
          onStructureCommand={(axis, operation, index) => void applyStructure(axis, operation, index)}
          structureBusy={structureBusy}
          onFilterClick={(column, headerText) => {
            setNotice(null);
            setFilterColumn({ column, headerText });
          }}
          onDropdownSelect={(address, value) => void commitCells({ [address]: value })}
        />
      </WorksheetTabs>
      {worksheetToRename ? (
        <RenameWorksheetDialog
          workbook={workbook}
          worksheet={worksheetToRename}
          onCancel={() => setRenamingWorksheetId(null)}
          onRenamed={(updated) => {
            onWorkbookChange(updated);
            setRenamingWorksheetId(null);
          }}
        />
      ) : null}
      {filterColumn && activeWorksheet.filter ? (
        <FilterDialog
          key={`${activeWorksheet.id}-${filterColumn.column}`}
          workbookId={workbook.id}
          worksheet={activeWorksheet}
          filter={activeWorksheet.filter}
          column={filterColumn.column}
          headerText={filterColumn.headerText}
          onSaved={(updated) => {
            onWorkbookChange(updated);
            setFilterColumn(null);
          }}
          onClose={() => setFilterColumn(null)}
        />
      ) : null}
      {validationRange ? (
        <DataValidationDialog
          key={`${activeWorksheet.id}-${validationRange.start}-${validationRange.end}`}
          workbookId={workbook.id}
          worksheet={activeWorksheet}
          range={validationRange}
          existingRule={ruleForRegion(activeWorksheet, validationRange)}
          onSaved={(updated) => {
            onWorkbookChange(updated);
            setValidationRange(null);
          }}
          onClose={() => setValidationRange(null)}
        />
      ) : null}
    </main>
  );
}

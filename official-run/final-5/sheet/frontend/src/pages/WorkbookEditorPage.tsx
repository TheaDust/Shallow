import { useEffect, useRef, useState } from "react";

import { Button } from "../ui/Button";
import { Menu } from "../ui/Menu";
import { CreatePivotDialog } from "../components/CreatePivotDialog";
import { CellNoteDialog } from "../components/CellNoteDialog";
import { ConditionalFormattingDialog } from "../components/ConditionalFormattingDialog";
import { DataValidationDialog } from "../components/DataValidationDialog";
import { DeleteWorksheetDialog } from "../components/DeleteWorksheetDialog";
import { FilterDialog } from "../components/FilterDialog";
import { FilterViewsPanel } from "../components/FilterViewsPanel";
import { FindReplaceDialog } from "../components/FindReplaceDialog";
import { FormulaBar } from "../components/FormulaBar";
import { PivotTableEditor } from "../components/PivotTableEditor";
import { NamedRangesDialog } from "../components/NamedRangesDialog";
import { RenameWorkbookDialog } from "../components/RenameWorkbookDialog";
import { RenameWorksheetDialog } from "../components/RenameWorksheetDialog";
import { SaveFilterViewPanel } from "../components/SaveFilterViewPanel";
import { SortRangeDialog } from "../components/SortRangeDialog";
import { WorksheetGrid, type StructureDirection } from "../components/WorksheetGrid";
import { WorksheetTabs } from "../components/WorksheetTabs";
import {
  adjustRows,
  areaOfRegion,
  formatClipboardText,
  parseClipboardText,
  rectangleCells,
  rowsFromRegion,
} from "../domain/clipboard";
import { worksheetToCsv } from "../domain/csv";
import { computeDisplayValues } from "../domain/formula";
import { findMatches, matchMessage, nextMatchIndex, replacedMessage, type FindRequest, type ReplaceRequest } from "../domain/find-replace";
import {
  freezeColumnsLabel,
  freezePanesLabel,
  freezeRowsLabel,
  frozenPanesLabel,
  frozenPanesOf,
  panesAboveAndLeft,
} from "../domain/freeze";
import {
  dataRegionAround,
  distinctColumnValues,
  emptyFilter,
  filterColumnFor,
  filterRegion,
  headerColumns,
} from "../domain/filter";
import { pivotFieldError, pivotFieldOptions } from "../domain/pivot";
import { sortColumns, type SortColumn } from "../domain/sort";
import { cellName, formatLastUpdated, parseCellName, regionBetween, type CellRegion } from "../domain/grid";
import { buildNamedRangeMap } from "../domain/named-ranges";
import type { ConditionalFormatRule, FilterColumn, FilterView, PivotConfig, ValidationRule, Workbook, Worksheet, WorksheetSelection } from "../domain/types";
import { LAST_WORKSHEET_MESSAGE } from "../domain/types";
import { findRuleForRegion } from "../domain/validation";
import { makeHash } from "../lib/hash-route";
import { downloadTextFile } from "../lib/download";
import {
  addWorksheet,
  applyCellRange,
  applyCellUpdates,
  applyPivotConfig,
  changeStructure,
  clearFilter,
  createPivotTable,
  deleteConditionalFormat,
  deleteCellNote,
  deleteFilterView,
  deleteValidationRule,
  deleteWorksheet,
  fetchWorkbook,
  refreshPivotTable,
  renameWorkbook,
  renameWorksheet,
  replaceWorksheetState,
  saveConditionalFormat,
  saveFilter,
  saveFilterView,
  saveCellNote,
  saveNamedRange,
  saveValidationRule,
  selectRange,
  setActiveWorksheet,
  setFreeze,
  sortRange,
  transferRange,
  updateCell,
  type StructureAxis,
  type StructureMode,
} from "../lib/workbook-api";
import { snapshotWorksheet, useWorksheetHistory, type WorksheetSnapshot } from "./useWorksheetHistory";

const GRID_PANEL_ID = "worksheet-grid-panel";
const DEFAULT_SELECTION: WorksheetSelection = { anchor: "A1", focus: "A1" };

/** A copied or cut range of one worksheet, kept for the current session only. */
interface InternalClipboard {
  mode: "copy" | "cut";
  worksheetId: string;
  region: CellRegion;
  rows: string[][];
}

/** Name of the worksheet being renamed, or an empty string when it is gone. */
function activeWorksheetName(workbook: Workbook, worksheetId: string): string {
  return workbook.worksheets.find((worksheet) => worksheet.id === worksheetId)?.name ?? "";
}

/** Writes `coordinate` in `cells`, removing it when the value is cleared. */
function withCellValue(
  cells: Record<string, string>,
  coordinate: string,
  value: string | undefined,
): Record<string, string> {
  const next = { ...cells };
  if (value === undefined || value === "") {
    delete next[coordinate];
  } else {
    next[coordinate] = value;
  }
  return next;
}

/**
 * Returns a copy of `workbook` with `worksheetId`'s cells/selection replaced.
 * Used for optimistic updates before the server confirms a write.
 */
function withWorksheet(
  workbook: Workbook,
  worksheetId: string,
  change: (worksheet: Workbook["worksheets"][number]) => Workbook["worksheets"][number],
): Workbook {
  return {
    ...workbook,
    worksheets: workbook.worksheets.map((worksheet) => (worksheet.id === worksheetId ? change(worksheet) : worksheet)),
  };
}

/** Best-effort mirror of the copied range into the operating-system clipboard. */
function writeSystemClipboard(text: string): void {
  try {
    const clipboard = navigator.clipboard;
    if (clipboard && typeof clipboard.writeText === "function") {
      void clipboard.writeText(text).catch(() => undefined);
    }
  } catch {
    // The internal clipboard still holds the range, so copying keeps working.
  }
}

export interface WorkbookEditorPageProps {
  workbookId: string;
}

export function WorkbookEditorPage({ workbookId }: WorkbookEditorPageProps) {
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameWorksheetId, setRenameWorksheetId] = useState<string | null>(null);
  const [deleteWorksheetId, setDeleteWorksheetId] = useState<string | null>(null);
  const [worksheetError, setWorksheetError] = useState<string | null>(null);
  const [cellError, setCellError] = useState<string | null>(null);
  const [structureError, setStructureError] = useState<string | null>(null);
  const [validationOpen, setValidationOpen] = useState(false);
  const [filterTarget, setFilterTarget] = useState<{ column: number; header: string } | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [saveFilterViewOpen, setSaveFilterViewOpen] = useState(false);
  const [filterViewsOpen, setFilterViewsOpen] = useState(false);
  const [pivotError, setPivotError] = useState<string | null>(null);
  const [pivotDialogOpen, setPivotDialogOpen] = useState(false);
  const [pivotSourceRange, setPivotSourceRange] = useState("");
  /** Range and column options of the open "Sort range" dialog, or `null`. */
  const [sortTarget, setSortTarget] = useState<{ range: string; columns: SortColumn[] } | null>(null);
  const [sortError, setSortError] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [namedRangesOpen, setNamedRangesOpen] = useState(false);
  const [conditionalFormattingOpen, setConditionalFormattingOpen] = useState(false);
  /** Cell coordinate whose note dialog is open, or `null`. */
  const [noteCoordinate, setNoteCoordinate] = useState<string | null>(null);
  const [clipboardFilled, setClipboardFilled] = useState(false);
  /** Last raw text sent per `worksheetId:coordinate`, used to drop stale saves. */
  const pendingCellWrites = useRef(new Map<string, string>());
  const clipboardRef = useRef<InternalClipboard | null>(null);
  const history = useWorksheetHistory(workbookId);

  useEffect(() => {
    let active = true;
    setWorkbook(null);
    setError(null);
    fetchWorkbook(workbookId)
      .then((loaded) => {
        if (active) setWorkbook(loaded);
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Unable to load workbook");
        }
      });
    return () => {
      active = false;
    };
  }, [workbookId]);

  if (error) {
    return (
      <>
        <nav className="page-nav">
          <a href={makeHash("/")}>Home</a>
        </nav>
        <p role="alert">{error}</p>
      </>
    );
  }

  if (!workbook) {
    return (
      <>
        <nav className="page-nav">
          <a href={makeHash("/")}>Home</a>
        </nav>
        <p role="status">Loading workbook…</p>
      </>
    );
  }

  const activeWorksheet =
    workbook.worksheets.find((worksheet) => worksheet.id === workbook.activeWorksheetId) ?? workbook.worksheets[0];
  const selection = activeWorksheet.selection ?? DEFAULT_SELECTION;
  const selectionRegion = regionBetween(selection.anchor, selection.focus);
  const selectionStart = cellName(selectionRegion.top, selectionRegion.left);
  // Named ranges of the workbook resolved for this worksheet, so every display
  // calculation (grid, find/replace, filter, export) reads the same cells.
  const namedRangeMap = buildNamedRangeMap(workbook.namedRanges, activeWorksheet.name);
  const displayCells = (cells: Record<string, string>) => computeDisplayValues(cells, namedRangeMap);
  // A pivot worksheet shows which source worksheet and headers it reads: the
  // options of its editor and the error of a field the source no longer has.
  const pivot = activeWorksheet.pivot ?? null;
  const pivotSourceWorksheet = pivot
    ? workbook.worksheets.find((worksheet) => worksheet.id === pivot.sourceWorksheetId)
    : undefined;
  const pivotHeaders = pivot ? pivotFieldOptions(pivotSourceWorksheet, pivot.range) : [];
  // Frozen panes of the active worksheet and the labels the "View" menu builds
  // from the current selection.
  const frozen = frozenPanesOf(activeWorksheet);
  const selectionCell = parseCellName(selection.anchor) ?? { row: 1, column: 1 };
  const selectionCoordinate = cellName(selectionCell.row, selectionCell.column);
  const panesAtSelection = panesAboveAndLeft(selectionCell);

  /** Live rectangle update while the pointer is selecting; nothing is persisted yet. */
  const updateSelection = (anchor: string, focus: string) => {
    const worksheetId = activeWorksheet.id;
    setWorkbook((current) =>
      current
        ? withWorksheet(current, worksheetId, (worksheet) => ({ ...worksheet, selection: { anchor, focus } }))
        : current,
    );
  };

  /**
   * Persists the finished rectangle so it survives a refresh. The selection is
   * view state for this worksheet only: a failure reports an error without
   * touching cells, and switching worksheets keeps each stored rectangle.
   */
  const commitSelection = (anchor: string, focus: string) => {
    const worksheetId = activeWorksheet.id;
    updateSelection(anchor, focus);
    selectRange(workbook.id, worksheetId, anchor, focus).catch((caught: unknown) => {
      setCellError(caught instanceof Error ? caught.message : "Unable to save the selection");
    });
  };

  const switchWorksheet = async (worksheetId: string) => {
    if (worksheetId === workbook.activeWorksheetId) return;
    const previous = workbook;
    setWorkbook({ ...workbook, activeWorksheetId: worksheetId });
    try {
      setWorkbook(await setActiveWorksheet(workbook.id, worksheetId));
    } catch {
      setWorkbook(previous);
    }
  };

  const saveName = async (name: string) => {
    setWorkbook(await renameWorkbook(workbook.id, name));
  };

  /**
   * Adds a blank worksheet (first unused SheetN name) and switches to it. A
   * failed addition reports an error and leaves the existing tabs untouched.
   */
  const addWorksheetTab = async () => {
    setWorksheetError(null);
    try {
      setWorkbook(await addWorksheet(workbook.id));
    } catch (caught) {
      setWorksheetError(caught instanceof Error ? caught.message : "Unable to add worksheet");
    }
  };

  const saveWorksheetName = async (name: string) => {
    if (!renameWorksheetId) return;
    setWorkbook(await renameWorksheet(workbook.id, renameWorksheetId, name));
  };

  /**
   * Asks to delete a worksheet. A workbook always keeps one worksheet, so the
   * last remaining tab reports the message directly without opening the
   * confirmation dialog; otherwise the confirmation describes the target.
   */
  const requestDeleteWorksheet = (worksheetId: string) => {
    setWorksheetError(null);
    if (workbook.worksheets.length <= 1) {
      setWorksheetError(LAST_WORKSHEET_MESSAGE);
      return;
    }
    setDeleteWorksheetId(worksheetId);
  };

  /**
   * Deletes the confirmed worksheet. The server keeps at least one worksheet
   * and rejects one that a pivot result still reads; a rejection reports its
   * message and leaves the target tab, its grid and the pivot results as they
   * were. A success replaces the whole stored workbook, so the removed tab
   * never reappears after a refresh.
   */
  const performDeleteWorksheet = async () => {
    if (!deleteWorksheetId) return;
    setWorksheetError(null);
    try {
      setWorkbook(await deleteWorksheet(workbook.id, deleteWorksheetId));
    } catch (caught) {
      setWorksheetError(caught instanceof Error ? caught.message : "Unable to delete worksheet");
    }
  };

  /**
   * Applies the server's cell map for one worksheet without touching anything
   * else. Concurrent writes (for example a selection save racing a cell edit)
   * therefore never clobber each other's slice of the editor state.
   */
  const applySavedCells = (saved: Workbook, worksheetId: string) => {
    const savedWorksheet = saved.worksheets.find((worksheet) => worksheet.id === worksheetId);
    if (!savedWorksheet) return;
    setWorkbook((current) =>
      current ? withWorksheet(current, worksheetId, (worksheet) => ({ ...worksheet, cells: savedWorksheet.cells })) : current,
    );
  };

  /**
   * Cell edit committed from the grid or the formula bar. The new text is shown
   * right away and persisted atomically by the server; a failed save is reported
   * and the cell falls back to its last successful value, so dependent formula
   * results stay unchanged.
   */
  const commitCell = (worksheetId: string, coordinate: string, rawText: string) => {
    const worksheet = workbook.worksheets.find((candidate) => candidate.id === worksheetId);
    if (!worksheet) return;
    const key = `${worksheetId}:${coordinate}`;
    const previous = worksheet.cells[coordinate];
    const before = snapshotWorksheet(worksheet);
    pendingCellWrites.current.set(key, rawText);
    setCellError(null);
    setWorkbook((current) =>
      current
        ? withWorksheet(current, worksheetId, (candidate) => ({
            ...candidate,
            cells: withCellValue(candidate.cells, coordinate, rawText),
          }))
        : current,
    );
    updateCell(workbook.id, worksheetId, coordinate, rawText)
      .then((saved) => {
        if (pendingCellWrites.current.get(key) !== rawText) return;
        pendingCellWrites.current.delete(key);
        applySavedCells(saved, worksheetId);
        history.record(before);
      })
      .catch((caught: unknown) => {
        if (pendingCellWrites.current.get(key) !== rawText) return;
        pendingCellWrites.current.delete(key);
        setWorkbook((current) =>
          current
            ? withWorksheet(current, worksheetId, (candidate) => ({
                ...candidate,
                cells: withCellValue(candidate.cells, coordinate, previous),
              }))
            : current,
        );
        setCellError(caught instanceof Error ? caught.message : "Unable to save the cell");
      });
  };

  /**
   * Pastes external clipboard text as a two-dimensional rectangle starting at
   * `start`. The whole rectangle is written in one atomic request: on success
   * the server's state replaces the optimistic grid, and on failure the
   * pre-paste workbook is restored with an error, so no partial values remain.
   */
  const applyPaste = (start: string, text: string) => {
    const rows = parseClipboardText(text);
    if (!rows.length) return;
    const worksheetId = activeWorksheet.id;
    const previousCells = activeWorksheet.cells;
    const before = snapshotWorksheet(activeWorksheet);
    const updates = rectangleCells(start, rows);
    setCellError(null);
    setWorkbook((current) =>
      current
        ? withWorksheet(current, worksheetId, (worksheet) => {
            const cells = { ...worksheet.cells };
            for (const { coordinate, value } of updates) {
              if (value === "") delete cells[coordinate];
              else cells[coordinate] = value;
            }
            return { ...worksheet, cells };
          })
        : current,
    );
    applyCellRange(workbook.id, worksheetId, start, rows)
      .then((saved) => {
        applySavedCells(saved, worksheetId);
        history.record(before);
      })
      .catch((caught: unknown) => {
        setWorkbook((current) =>
          current ? withWorksheet(current, worksheetId, (worksheet) => ({ ...worksheet, cells: previousCells })) : current,
        );
        setCellError(caught instanceof Error ? caught.message : "Unable to paste the values");
      });
  };

  /**
   * Clears every cell of the current selected rectangle (Delete key). The whole
   * rectangle is written as empty text in one atomic request: the grid shows the
   * cleared cells and the selection stays active, formula cells lose their
   * original formula so dependent results recalculate from the remaining values.
   * A rejected clear restores the last successful values and reports the error,
   * so no partial deletion remains.
   */
  const clearSelection = () => {
    const worksheetId = activeWorksheet.id;
    const start = selectionStart;
    const previousCells = activeWorksheet.cells;
    const before = snapshotWorksheet(activeWorksheet);
    const rows = Array.from({ length: selectionRegion.bottom - selectionRegion.top + 1 }, () =>
      Array.from({ length: selectionRegion.right - selectionRegion.left + 1 }, () => ""),
    );
    setCellError(null);
    setWorkbook((current) =>
      current
        ? withWorksheet(current, worksheetId, (worksheet) => {
            const cells = { ...worksheet.cells };
            for (let row = selectionRegion.top; row <= selectionRegion.bottom; row += 1) {
              for (let column = selectionRegion.left; column <= selectionRegion.right; column += 1) {
                delete cells[cellName(row, column)];
              }
            }
            return { ...worksheet, cells };
          })
        : current,
    );
    applyCellRange(workbook.id, worksheetId, start, rows)
      .then((saved) => {
        applySavedCells(saved, worksheetId);
        history.record(before);
      })
      .catch((caught: unknown) => {
        setWorkbook((current) =>
          current ? withWorksheet(current, worksheetId, (worksheet) => ({ ...worksheet, cells: previousCells })) : current,
        );
        setCellError(caught instanceof Error ? caught.message : "Unable to clear the cells");
      });
  };

  /**
   * Transfers the internal copied or cut range onto `start`. The target is
   * written with formulas adjusted for the offset (a copy) or moved verbatim
   * while the source is cleared (a cut) in one atomic request: the grid only
   * changes after the server confirms the whole move, so a rejected transfer
   * keeps both ranges exactly as they were.
   */
  const applyTransfer = async (start: string, clip: InternalClipboard) => {
    const origin = parseCellName(start);
    if (!origin) return;
    const target = cellName(origin.row, origin.column);
    const rowOffset = origin.row - clip.region.top;
    const columnOffset = origin.column - clip.region.left;
    const rows = clip.mode === "copy" ? adjustRows(clip.rows, rowOffset, columnOffset) : clip.rows.map((row) => [...row]);
    const source = clip.mode === "cut" ? areaOfRegion(clip.region) : undefined;
    const worksheetId = activeWorksheet.id;
    const before = snapshotWorksheet(activeWorksheet);
    setCellError(null);
    try {
      const saved = await transferRange(workbook.id, worksheetId, { target, rows, source });
      applySavedCells(saved, worksheetId);
      history.record(before);
      if (clip.mode === "cut") {
        clipboardRef.current = null;
        setClipboardFilled(false);
      }
    } catch (caught) {
      setCellError(caught instanceof Error ? caught.message : "Unable to paste the range");
    }
  };

  /** Captures the current selection rectangle for a later copy or cut. */
  const captureSelection = (mode: "copy" | "cut") => {
    const rows = rowsFromRegion(activeWorksheet.cells, selectionRegion);
    if (!rows.length) return;
    clipboardRef.current = { mode, worksheetId: activeWorksheet.id, region: selectionRegion, rows };
    setClipboardFilled(true);
    setCellError(null);
    writeSystemClipboard(formatClipboardText(rows));
  };

  /**
   * Paste pasted through the grid: the internal range wins while it belongs to
   * this worksheet, otherwise the external text is applied.
   */
  const handlePaste = (start: string, text: string) => {
    const clip = clipboardRef.current;
    if (clip && clip.worksheetId === activeWorksheet.id) {
      void applyTransfer(start, clip);
      return;
    }
    if (text) applyPaste(start, text);
  };

  /** Paste command (toolbar or context menu) that also accepts the system clipboard. */
  const pasteCommand = async (start: string) => {
    const clip = clipboardRef.current;
    if (clip && clip.worksheetId === activeWorksheet.id) {
      await applyTransfer(start, clip);
      return;
    }
    try {
      const clipboard = navigator.clipboard;
      if (!clipboard || typeof clipboard.readText !== "function") throw new Error("clipboard unavailable");
      const text = await clipboard.readText();
      if (text) applyPaste(start, text);
    } catch {
      setCellError("Unable to read the clipboard");
    }
  };

  /**
   * Inserts or deletes one row or column of the active worksheet. The change is
   * persisted first: the grid keeps the pre-operation structure until the
   * server confirms, and a failure reports an error without moving anything.
   */
  const changeLine = async (axis: StructureAxis, mode: StructureMode, index: number) => {
    setStructureError(null);
    const before = snapshotWorksheet(activeWorksheet);
    try {
      setWorkbook(await changeStructure(workbook.id, activeWorksheet.id, { axis, mode, index }));
      history.record(before);
    } catch (caught) {
      setStructureError(caught instanceof Error ? caught.message : "Unable to change the row or column structure");
    }
  };

  const insertLine = (axis: StructureAxis, index: number, direction: StructureDirection) =>
    changeLine(axis, direction === "before" ? "insert-before" : "insert-after", index);

  const deleteLine = (axis: StructureAxis, index: number) => changeLine(axis, "delete", index);

  /** Current persisted snapshot of one worksheet, used as the opposite stack entry. */
  const currentSnapshotFor = (worksheetId: string): WorksheetSnapshot =>
    snapshotWorksheet(workbook.worksheets.find((worksheet) => worksheet.id === worksheetId) ?? activeWorksheet);

  /**
   * Restores a snapshot through the server so the undone or redone state stays
   * persisted after a refresh. A failed restore puts the stacks back untouched
   * and reports the error, leaving the grid at its last successful state.
   */
  const restoreSnapshot = async (target: WorksheetSnapshot) => {
    setCellError(null);
    try {
      const saved = await replaceWorksheetState(workbook.id, target.worksheetId, {
        cells: target.cells,
        validationRules: target.validationRules,
      });
      setWorkbook(saved);
    } catch (caught) {
      history.restoreFailed();
      setCellError(caught instanceof Error ? caught.message : "Unable to restore the worksheet");
    }
  };

  const undo = () => {
    const target = history.takeUndo(currentSnapshotFor);
    if (target) void restoreSnapshot(target);
  };

  const redo = () => {
    const target = history.takeRedo(currentSnapshotFor);
    if (target) void restoreSnapshot(target);
  };

  /**
   * Saves the validation rule for the current selection. The server keeps the
   * rule (and every other rule) atomically, so a rejected payload changes
   * neither cells nor rules; the previous worksheet state stays undoable.
   */
  const saveValidation = async (rule: ValidationRule) => {
    const before = snapshotWorksheet(activeWorksheet);
    const saved = await saveValidationRule(workbook.id, activeWorksheet.id, rule);
    setWorkbook(saved);
    history.record(before);
  };

  /** Removes the rule covering the current selection; cells stay untouched. */
  const removeValidation = async () => {
    const before = snapshotWorksheet(activeWorksheet);
    const saved = await deleteValidationRule(workbook.id, activeWorksheet.id, areaOfRegion(selectionRegion));
    setWorkbook(saved);
    history.record(before);
  };

  /**
   * Creates a filter view over a data region. A multi-cell selection is used
   * exactly as selected; a single selected cell grows to the contiguous used
   * region around it, so the surrounding table with its headers becomes the
   * filtered range. Only the view is stored: no cell is ever removed or moved.
   */
  const createFilter = async () => {
    setFilterError(null);
    const display = displayCells(activeWorksheet.cells);
    const single =
      selectionRegion.top === selectionRegion.bottom && selectionRegion.left === selectionRegion.right;
    const anchor = parseCellName(selectionStart);
    const region = single && anchor ? dataRegionAround(display, anchor) : selectionRegion;
    const filter = emptyFilter(display, region);
    if (filter.columns.length === 0) {
      setFilterError("Select a range with header cells to create a filter");
      return;
    }
    try {
      setWorkbook(await saveFilter(workbook.id, activeWorksheet.id, filter));
    } catch (caught) {
      setFilterError(caught instanceof Error ? caught.message : "Unable to create the filter");
    }
  };

  /** Removes the filter view of the active worksheet; every record reappears. */
  const clearActiveFilter = async () => {
    if (!activeWorksheet.filter) return;
    setFilterError(null);
    try {
      setWorkbook(await clearFilter(workbook.id, activeWorksheet.id));
    } catch (caught) {
      setFilterError(caught instanceof Error ? caught.message : "Unable to clear the filter");
    }
  };

  /** Stores one column rule of the filter view; other columns are untouched. */
  const applyFilterColumn = async (rule: FilterColumn) => {
    const current = activeWorksheet.filter;
    if (!current) return;
    const columns = current.columns.some((candidate) => candidate.column === rule.column)
      ? current.columns.map((candidate) => (candidate.column === rule.column ? rule : candidate))
      : [...current.columns, rule];
    setWorkbook(await saveFilter(workbook.id, activeWorksheet.id, { ...current, columns }));
  };

  /**
   * Saves the worksheet's currently applied filter as a named filter view. The
   * server validates the name (trimmed, nonempty, unique within the workbook),
   * so a duplicate rejects with its exact message and no view is added.
   */
  const saveCurrentFilterView = async (name: string) => {
    setWorkbook(await saveFilterView(workbook.id, activeWorksheet.id, name));
  };

  /**
   * Applies a saved filter view: its stored criteria replace the worksheet's
   * current filter, so the view decides which records stay visible. Cells and
   * their order are never changed.
   */
  const applySavedFilterView = async (view: FilterView) => {
    setWorkbook(await saveFilter(workbook.id, activeWorksheet.id, view.filter));
  };

  /** Deletes a saved filter view; the server also restores every source row. */
  const removeSavedFilterView = async (view: FilterView) => {
    setWorkbook(await deleteFilterView(workbook.id, activeWorksheet.id, view.id));
  };

  /**
   * Opens the pivot dialog for the current selection. A multi-cell selection is
   * used as the source range; a single selected cell grows to the contiguous
   * used region around it, so the surrounding table with its headers becomes the
   * source. A selection without header cells is reported instead.
   */
  const openCreatePivot = () => {
    setPivotError(null);
    const single = selectionRegion.top === selectionRegion.bottom && selectionRegion.left === selectionRegion.right;
    const anchor = parseCellName(selectionStart);
    const region = single && anchor ? dataRegionAround(activeWorksheet.cells, anchor) : selectionRegion;
    if (headerColumns(activeWorksheet.cells, region).length === 0) {
      setPivotError("Select a range with header cells to create a pivot table");
      return;
    }
    setPivotSourceRange(areaOfRegion(region));
    setPivotDialogOpen(true);
  };

  /**
   * Creates the pivot worksheet from the selected range. Only the source cells
   * are read: the server derives the whole summary and the new `PivotN`
   * worksheet becomes active. A failure creates nothing.
   */
  const createPivot = async () => {
    setPivotError(null);
    setWorkbook(await createPivotTable(workbook.id, activeWorksheet.id, pivotSourceRange));
  };

  /**
   * Opens the "Sort range" dialog for the current selection. A multi-cell
   * selection is used exactly as selected (never grown to neighbouring data);
   * a single selected cell grows to the contiguous used region around it, so
   * the surrounding table becomes the range. A selection without a data row is
   * reported instead.
   */
  const openSort = () => {
    setSortError(null);
    const display = displayCells(activeWorksheet.cells);
    const single =
      selectionRegion.top === selectionRegion.bottom && selectionRegion.left === selectionRegion.right;
    const anchor = parseCellName(selectionStart);
    const region = single && anchor ? dataRegionAround(display, anchor) : selectionRegion;
    if (region.bottom <= region.top) {
      setSortError("Select a range with data rows to sort");
      return;
    }
    setSortTarget({ range: areaOfRegion(region), columns: sortColumns(display, region) });
  };

  /**
   * Sorts the selected range through the server in one atomic write. The whole
   * record order is replaced only after the server confirms; a rejected sort
   * reports its message and leaves the grid at its original order.
   */
  const applySort = async (request: { column: number; order: "asc" | "desc"; hasHeaderRow: boolean }) => {
    if (!sortTarget) return;
    const before = snapshotWorksheet(activeWorksheet);
    const saved = await sortRange(workbook.id, activeWorksheet.id, { range: sortTarget.range, ...request });
    setWorkbook(saved);
    history.record(before);
  };

  /** Replaces the pivot worksheet's field layout and its summary. */
  const applyPivot = async (config: PivotConfig) => {
    setWorkbook(await applyPivotConfig(workbook.id, activeWorksheet.id, config));
  };

  /** Recomputes the pivot worksheet from the current source data. */
  const refreshPivot = async () => {
    setWorkbook(await refreshPivotTable(workbook.id, activeWorksheet.id));
  };

  /**
   * Saves a named range. The server validates the name (it must start with a
   * letter) and canonicalises the reference, so a rejected save adds no name.
   */
  const saveNamedRangeEntry = async (name: string, range: string) => {
    setWorkbook(await saveNamedRange(workbook.id, name, range));
  };

  /**
   * Saves a conditional-formatting rule: a new one is appended, an edited one
   * replaces the rule at `index`. The grid repaints the affected fills as soon
   * as the response arrives, so an edit is visible immediately.
   */
  const saveConditionalFormatRule = async (rule: ConditionalFormatRule, index: number | null) => {
    setWorkbook(await saveConditionalFormat(workbook.id, activeWorksheet.id, rule, index ?? undefined));
  };

  /**
   * Stores the note of the open cell. The server keeps the note as an
   * annotation of its coordinate, so the cell keeps displaying its value and a
   * refresh shows the same note with its open button.
   */
  const saveCellNoteText = async (text: string) => {
    if (!noteCoordinate) return;
    setWorkbook(await saveCellNote(workbook.id, activeWorksheet.id, noteCoordinate, text));
  };

  /** Removes the note of the open cell; its cell value and other notes stay. */
  const removeCellNote = async () => {
    if (!noteCoordinate) return;
    setWorkbook(await deleteCellNote(workbook.id, activeWorksheet.id, noteCoordinate));
  };

  /** Removes one conditional-formatting rule; its fill disappears from the grid. */
  const removeConditionalFormatRule = async (index: number) => {
    setWorkbook(await deleteConditionalFormat(workbook.id, activeWorksheet.id, index));
  };

  /**
   * Selects the next cell whose entire displayed value equals the Find text.
   * The walk starts after the current cell and wraps around, so repeated clicks
   * cycle through the matches of the active worksheet; the returned message
   * reports the position of the selected match.
   */
  const findNextMatch = (request: FindRequest): string | null => {
    const matches = findMatches(displayCells(activeWorksheet.cells), request.find, request.matchCase);
    const index = nextMatchIndex(matches, selection.anchor);
    if (index === -1) return null;
    const coordinate = matches[index];
    commitSelection(coordinate, coordinate);
    return matchMessage(index + 1, matches.length);
  };

  /**
   * Rewrites every matching cell of the active worksheet in one atomic request.
   * The server applies all replacements or none, so a rejected replacement
   * reports its message and leaves the grid at its last successful state while
   * a successful one stays after a refresh.
   */
  const replaceMatchingCells = async (request: ReplaceRequest): Promise<string> => {
    const matches = findMatches(displayCells(activeWorksheet.cells), request.find, request.matchCase);
    if (matches.length === 0) return replacedMessage(0);
    const before = snapshotWorksheet(activeWorksheet);
    const saved = await applyCellUpdates(
      workbook.id,
      activeWorksheet.id,
      matches.map((coordinate) => ({ coordinate, value: request.replaceWith })),
    );
    setWorkbook(saved);
    history.record(before);
    return replacedMessage(matches.length);
  };

  /**
   * Stores the frozen panes of the active worksheet. The server keeps the two
   * counts per worksheet, so the state button shows the same values after a
   * refresh and while switching worksheets.
   */
  const applyFreeze = async (rows: number, columns: number) => {
    setCellError(null);
    try {
      setWorkbook(await setFreeze(workbook.id, activeWorksheet.id, rows, columns));
    } catch (caught) {
      setCellError(caught instanceof Error ? caught.message : "Unable to freeze the panes");
    }
  };

  const exportCsv = () => {
    // Formula cells export their calculated result, not the expression.
    downloadTextFile(`${workbook.name}.csv`, worksheetToCsv({ cells: displayCells(activeWorksheet.cells) }));
  };

  return (
    <>
      <nav className="page-nav">
        <a href={makeHash("/")}>Home</a>
      </nav>
      <header className="editor-header">
        <h1>{workbook.name}</h1>
        <Button onClick={() => setRenameOpen(true)}>Rename workbook</Button>
      </header>
      <p className="editor-updated">{formatLastUpdated(workbook.updatedAt)}</p>
      <div className="editor-toolbar">
        <Button onClick={undo} disabled={!history.canUndo}>
          Undo
        </Button>
        <Button onClick={redo} disabled={!history.canRedo}>
          Redo
        </Button>
        <Button onClick={() => captureSelection("copy")}>Copy</Button>
        <Button onClick={() => captureSelection("cut")}>Cut</Button>
        <Button onClick={() => void pasteCommand(selectionStart)}>Paste</Button>
        <Button onClick={exportCsv}>Export CSV</Button>
        <Menu
          triggerLabel="Edit"
          items={[{ id: "find-replace", label: "Find and replace", onSelect: () => setFindOpen(true) }]}
        />
        <Menu
          triggerLabel="Insert"
          items={[{ id: "add-note", label: "Add note", onSelect: () => setNoteCoordinate(selectionCoordinate) }]}
        />
        <Menu
          triggerLabel="View"
          items={[
            {
              id: "freeze-rows",
              label: freezeRowsLabel(selectionCell.row),
              onSelect: () => void applyFreeze(selectionCell.row, frozen.columns),
            },
            {
              id: "freeze-columns",
              label: freezeColumnsLabel(selectionCell.column),
              onSelect: () => void applyFreeze(frozen.rows, selectionCell.column),
            },
            {
              id: "freeze-panes",
              label: freezePanesLabel(selectionCoordinate),
              onSelect: () => void applyFreeze(panesAtSelection.rows, panesAtSelection.columns),
            },
          ]}
        />
        <button type="button" className="editor-freeze-state">
          {frozenPanesLabel(frozen)}
        </button>
        <Menu
          triggerLabel="Data"
          items={[
            { id: "create-filter", label: "Create filter", onSelect: () => void createFilter() },
            { id: "clear-filter", label: "Clear filter", onSelect: () => void clearActiveFilter() },
            { id: "save-filter-view", label: "Save filter view", onSelect: () => setSaveFilterViewOpen(true) },
            { id: "filter-views", label: "Filter views", onSelect: () => setFilterViewsOpen(true) },
            { id: "sort-range", label: "Sort range", onSelect: openSort },
            { id: "data-validation", label: "Data validation", onSelect: () => setValidationOpen(true) },
            { id: "create-pivot", label: "Create pivot table", onSelect: openCreatePivot },
            { id: "named-ranges", label: "Named ranges", onSelect: () => setNamedRangesOpen(true) },
          ]}
        />
        <Menu
          triggerLabel="Format"
          items={[
            {
              id: "conditional-formatting",
              label: "Conditional formatting",
              onSelect: () => setConditionalFormattingOpen(true),
            },
          ]}
        />
      </div>
      <SaveFilterViewPanel
        open={saveFilterViewOpen}
        onClose={() => setSaveFilterViewOpen(false)}
        onSave={saveCurrentFilterView}
      />
      <FilterViewsPanel
        open={filterViewsOpen}
        views={activeWorksheet.filterViews ?? []}
        onClose={() => setFilterViewsOpen(false)}
        onApply={applySavedFilterView}
        onDelete={removeSavedFilterView}
      />
      <WorksheetTabs
        worksheets={workbook.worksheets}
        activeWorksheetId={activeWorksheet.id}
        gridId={GRID_PANEL_ID}
        onChange={switchWorksheet}
        onAdd={addWorksheetTab}
        onRename={setRenameWorksheetId}
        onDelete={requestDeleteWorksheet}
      />
      {worksheetError ? <p role="alert">{worksheetError}</p> : null}
      <FormulaBar
        value={activeWorksheet.cells[selection.anchor] ?? ""}
        coordinate={selection.anchor}
        onCommit={(coordinate, next) => commitCell(activeWorksheet.id, coordinate, next)}
      />
      {cellError ? <p role="alert">{cellError}</p> : null}
      {pivot ? (
        <PivotTableEditor
          pivot={pivot}
          fieldOptions={pivotHeaders}
          fieldError={pivotFieldError(pivot, pivotHeaders)}
          onApply={applyPivot}
          onRefresh={refreshPivot}
        />
      ) : null}
      <div id={GRID_PANEL_ID} role="tabpanel" aria-labelledby={`worksheet-tab-${activeWorksheet.id}`}>
        <WorksheetGrid
          worksheet={activeWorksheet}
          selection={selection}
          namedRanges={workbook.namedRanges}
          clipboardFilled={clipboardFilled}
          onSelectRange={updateSelection}
          onSelectionCommit={commitSelection}
          onEditCell={(coordinate, value) => commitCell(activeWorksheet.id, coordinate, value)}
          onPaste={handlePaste}
          onPasteCommand={pasteCommand}
          onCopy={() => captureSelection("copy")}
          onCut={() => captureSelection("cut")}
          onClear={clearSelection}
          onUndo={undo}
          onRedo={redo}
          onInsert={insertLine}
          onDelete={deleteLine}
          onFilter={(column, header) => {
            setFilterError(null);
            setFilterTarget({ column, header });
          }}
          onOpenNote={setNoteCoordinate}
        />
      </div>
      {structureError ? <p role="alert">{structureError}</p> : null}
      {filterError ? <p role="alert">{filterError}</p> : null}
      {sortError ? <p role="alert">{sortError}</p> : null}
      {pivotError ? <p role="alert">{pivotError}</p> : null}
      <RenameWorkbookDialog
        open={renameOpen}
        currentName={workbook.name}
        onOpenChange={setRenameOpen}
        onSave={saveName}
      />
      <CreatePivotDialog
        open={pivotDialogOpen}
        range={pivotSourceRange}
        onOpenChange={setPivotDialogOpen}
        onCreate={createPivot}
      />
      <DataValidationDialog
        open={validationOpen}
        range={areaOfRegion(selectionRegion)}
        rule={findRuleForRegion(activeWorksheet.validationRules, selectionRegion)}
        onOpenChange={setValidationOpen}
        onSave={saveValidation}
        onDelete={removeValidation}
      />
      <FilterDialog
        open={filterTarget !== null}
        column={filterTarget?.column ?? 1}
        header={filterTarget?.header ?? ""}
        values={
          filterTarget ? distinctColumnValues(displayCells(activeWorksheet.cells), activeWorksheet.filter, filterTarget.column) : []
        }
        rule={filterTarget ? filterColumnFor(activeWorksheet.filter, filterTarget.column) : null}
        onOpenChange={(open) => {
          if (!open) setFilterTarget(null);
        }}
        onApply={applyFilterColumn}
      />
      <SortRangeDialog
        open={sortTarget !== null}
        columns={sortTarget?.columns ?? []}
        onOpenChange={(open) => {
          if (!open) setSortTarget(null);
        }}
        onSort={applySort}
      />
      <RenameWorksheetDialog
        open={renameWorksheetId !== null}
        currentName={renameWorksheetId ? activeWorksheetName(workbook, renameWorksheetId) : ""}
        onOpenChange={(open) => {
          if (!open) setRenameWorksheetId(null);
        }}
        onSave={saveWorksheetName}
      />
      <DeleteWorksheetDialog
        open={deleteWorksheetId !== null}
        worksheetName={deleteWorksheetId ? activeWorksheetName(workbook, deleteWorksheetId) : ""}
        onOpenChange={(open) => {
          if (!open) setDeleteWorksheetId(null);
        }}
        onDelete={performDeleteWorksheet}
      />
      <FindReplaceDialog
        open={findOpen}
        onOpenChange={setFindOpen}
        onFindNext={findNextMatch}
        onReplaceAll={replaceMatchingCells}
      />
      <NamedRangesDialog
        open={namedRangesOpen}
        namedRanges={workbook.namedRanges ?? []}
        onOpenChange={setNamedRangesOpen}
        onSave={saveNamedRangeEntry}
      />
      <ConditionalFormattingDialog
        open={conditionalFormattingOpen}
        rules={activeWorksheet.conditionalFormats ?? []}
        selectionRange={areaOfRegion(selectionRegion)}
        onOpenChange={setConditionalFormattingOpen}
        onSave={saveConditionalFormatRule}
        onDelete={removeConditionalFormatRule}
      />
      <CellNoteDialog
        open={noteCoordinate !== null}
        coordinate={noteCoordinate ?? selectionCoordinate}
        note={noteCoordinate ? activeWorksheet.notes?.[noteCoordinate] ?? null : null}
        onOpenChange={(open) => {
          if (!open) setNoteCoordinate(null);
        }}
        onSave={saveCellNoteText}
        onDelete={removeCellNote}
      />
    </>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "../ui/Button";
import { Menu } from "../ui/Menu";
import { ConditionalFormattingDialog } from "../components/ConditionalFormattingDialog";
import { CreatePivotDialog } from "../components/CreatePivotDialog";
import { DataValidationDialog } from "../components/DataValidationDialog";
import { DeleteWorksheetDialog } from "../components/DeleteWorksheetDialog";
import { FilterDialog } from "../components/FilterDialog";
import { FilterViewsDialog } from "../components/FilterViewsDialog";
import { FindReplaceDialog } from "../components/FindReplaceDialog";
import { FormulaBar } from "../components/FormulaBar";
import { NamedRangesDialog } from "../components/NamedRangesDialog";
import { NoteDialog } from "../components/NoteDialog";
import { PivotTableEditor } from "../components/PivotTableEditor";
import { RenameWorkbookDialog } from "../components/RenameWorkbookDialog";
import { RenameWorksheetDialog } from "../components/RenameWorksheetDialog";
import { SaveFilterViewDialog } from "../components/SaveFilterViewDialog";
import { SortRangeDialog } from "../components/SortRangeDialog";
import { WorksheetGrid, type StructureDirection } from "../components/WorksheetGrid";
import { WorksheetTabs } from "../components/WorksheetTabs";
import {
  adjustRows,
  areaOfRegion,
  clearRegionCells,
  formatClipboardText,
  parseClipboardText,
  rectangleCells,
  rowsFromRegion,
} from "../domain/clipboard";
import { worksheetToCsv } from "../domain/csv";
import { computeDisplayValues } from "../domain/formula";
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
import { cellName, columnName, formatLastUpdated, parseCellName, regionBetween, type CellRegion } from "../domain/grid";
import { namedRangeLookup } from "../domain/namedRanges";
import type {
  FilterColumn,
  FilterView,
  FormatRule,
  PivotConfig,
  ValidationRule,
  Workbook,
  Worksheet,
  WorksheetFreeze,
  WorksheetSelection,
} from "../domain/types";
import { LAST_WORKSHEET_MESSAGE } from "../domain/types";
import { findRuleForRegion } from "../domain/validation";
import { makeHash } from "../lib/hash-route";
import { downloadTextFile } from "../lib/download";
import {
  addWorksheet,
  applyCellRange,
  applyPivotConfig,
  changeStructure,
  clearFilter,
  clearRange,
  createPivotTable,
  deleteFilterView,
  deleteFormatRule,
  deleteNote,
  deleteValidationRule,
  deleteWorksheet,
  fetchWorkbook,
  refreshPivotTable,
  renameWorkbook,
  renameWorksheet,
  replaceCells,
  replaceWorksheetState,
  saveFilter,
  saveFilterView,
  saveFormatRule,
  saveNamedRange,
  saveNote,
  saveValidationRule,
  selectRange,
  setActiveWorksheet,
  setFreeze,
  sortRange,
  transferRange,
  updateCell,
  type NamedRangeRequest,
  type StructureAxis,
  type StructureMode,
} from "../lib/workbook-api";
import { snapshotWorksheet, useWorksheetHistory, type WorksheetSnapshot } from "./useWorksheetHistory";

const GRID_PANEL_ID = "worksheet-grid-panel";
const DEFAULT_SELECTION: WorksheetSelection = { anchor: "A1", focus: "A1" };
/** Frozen pane counts of a worksheet with nothing frozen. */
const NO_FREEZE: WorksheetFreeze = { rows: 0, columns: 0 };

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
  const [namedRangesOpen, setNamedRangesOpen] = useState(false);
  /** Coordinate whose note dialog is open, or `null` while it is closed. */
  const [noteTarget, setNoteTarget] = useState<string | null>(null);
  const [formattingOpen, setFormattingOpen] = useState(false);
  /** Range and column options of the open "Sort range" dialog, or `null`. */
  const [sortTarget, setSortTarget] = useState<{ range: string; columns: SortColumn[] } | null>(null);
  const [sortError, setSortError] = useState<string | null>(null);
  const [freezeError, setFreezeError] = useState<string | null>(null);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [clipboardFilled, setClipboardFilled] = useState(false);
  /** Last raw text sent per `worksheetId:coordinate`, used to drop stale saves. */
  const pendingCellWrites = useRef(new Map<string, string>());
  const clipboardRef = useRef<InternalClipboard | null>(null);
  const history = useWorksheetHistory(workbookId);
  // Workbook named ranges resolve bare names inside formulas; the lookup is
  // rebuilt only when the stored workbook changes, so the grid's derived values
  // and fills recompute right after a name is added or edited.
  const namedRangeResolver = useMemo(() => (workbook ? namedRangeLookup(workbook) : null), [workbook]);

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
  // A pivot worksheet shows which source worksheet and headers it reads: the
  // options of its editor and the error of a field the source no longer has.
  const pivot = activeWorksheet.pivot ?? null;
  const pivotSourceWorksheet = pivot
    ? workbook.worksheets.find((worksheet) => worksheet.id === pivot.sourceWorksheetId)
    : undefined;
  const pivotHeaders = pivot ? pivotFieldOptions(pivotSourceWorksheet, pivot.range) : [];
  const freeze = activeWorksheet.freeze ?? NO_FREEZE;
  const selectionPosition = parseCellName(selection.anchor) ?? { row: 1, column: 1 };

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
   * Clears every cell of the current selection rectangle. The rectangle stays
   * selected but loses its raw texts (and, with them, the original formulas of
   * formula cells), so dependent results recalculate from the blanks right
   * away. The server write is atomic: a failure reports its error and restores
   * the last successful values, leaving dependent results unchanged.
   */
  const clearSelection = () => {
    const worksheetId = activeWorksheet.id;
    const previousCells = activeWorksheet.cells;
    const before = snapshotWorksheet(activeWorksheet);
    const area = areaOfRegion(selectionRegion);
    setCellError(null);
    setWorkbook((current) =>
      current
        ? withWorksheet(current, worksheetId, (worksheet) => ({
            ...worksheet,
            cells: clearRegionCells(worksheet.cells, selectionRegion),
          }))
        : current,
    );
    clearRange(workbook.id, worksheetId, area)
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
    const display = computeDisplayValues(activeWorksheet.cells, namedRangeResolver);
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
   * Saves the currently applied filter under a name. The criteria are stored as
   * they are; the applied filter and every cell stay unchanged, and a rejected
   * save (duplicate or empty name) is reported inside the open interface.
   */
  const saveCurrentFilterView = async (name: string) => {
    const current = activeWorksheet.filter;
    if (!current) throw new Error("Create a filter before saving a filter view");
    setWorkbook(await saveFilterView(workbook.id, activeWorksheet.id, name, current));
  };

  /**
   * Applies a saved view: the stored criteria replace the worksheet's current
   * filters in one atomic write, so the visible records follow the view and the
   * choice survives a refresh.
   */
  const applyFilterView = async (view: FilterView) => {
    setWorkbook(await saveFilter(workbook.id, activeWorksheet.id, view.filter));
  };

  /**
   * Deletes a saved view. The applied filter is cleared with it, so every
   * source record is visible again with its original value and order.
   */
  const removeFilterView = async (name: string) => {
    setWorkbook(await deleteFilterView(workbook.id, activeWorksheet.id, name));
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
    const display = computeDisplayValues(activeWorksheet.cells, namedRangeResolver);
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

  /**
   * Stores the frozen pane counts of the active worksheet. The server keeps the
   * counts (and the workbook's other state) in one atomic write, so the state
   * the editor shows — and reads back after a refresh — is the stored one; a
   * rejected request reports its error and keeps the previous counts.
   */
  const applyFreeze = async (next: WorksheetFreeze) => {
    const worksheetId = activeWorksheet.id;
    setFreezeError(null);
    try {
      setWorkbook(await setFreeze(workbook.id, worksheetId, next));
    } catch (caught) {
      setFreezeError(caught instanceof Error ? caught.message : "Unable to freeze the panes");
    }
  };

  /**
   * Replaces every cell of the active worksheet whose whole value equals the
   * Find text. The server rewrites the whole set in one atomic write and
   * reports how many cells changed, so a rejected replacement keeps every value
   * and the error is shown inside the open dialog.
   */
  const replaceAllCells = async (request: { find: string; replaceWith: string; matchCase: boolean }) => {
    const worksheetId = activeWorksheet.id;
    const before = snapshotWorksheet(activeWorksheet);
    setCellError(null);
    const result = await replaceCells(workbook.id, worksheetId, request);
    applySavedCells(result.workbook, worksheetId);
    // A replacement that changed nothing leaves nothing to undo.
    if (result.replaced > 0) history.record(before);
    return result.replaced;
  };

  /** Recomputes the pivot worksheet from the current source data. */
  const refreshPivot = async () => {
    setWorkbook(await refreshPivotTable(workbook.id, activeWorksheet.id));
  };

  /**
   * Saves a workbook named range. The server keeps one entry per name and
   * returns the whole stored workbook, so the dialog closes only after the name
   * is really available to formulas.
   */
  const storeNamedRange = async (input: NamedRangeRequest) => {
    setWorkbook(await saveNamedRange(workbook.id, input));
  };

  /**
   * Stores a conditional formatting rule: the rule at `index` is replaced when
   * one is given, otherwise a new rule is appended. Only the fill the grid
   * derives changes; no cell value is written.
   */
  const storeFormatRule = async (rule: FormatRule, index?: number) => {
    setWorkbook(await saveFormatRule(workbook.id, activeWorksheet.id, { ...rule, index }));
  };

  /** Removes one conditional formatting rule of the active worksheet. */
  const removeFormatRule = async (index: number) => {
    setWorkbook(await deleteFormatRule(workbook.id, activeWorksheet.id, index));
  };

  /**
   * Opens the note dialog of the selected cell: "Insert" → "Add note" annotates
   * the current cell, and a cell's own "Open note for X" button reopens the
   * stored note of exactly that cell.
   */
  const openNote = (coordinate: string) => setNoteTarget(coordinate);

  /**
   * Stores the note of the open cell without touching its value: the server
   * keeps the note atomically and returns the whole workbook, so the cell's
   * "Open note for <coordinate>" button appears right after a successful save
   * and disappears when the dialog deletes the note.
   */
  const storeNote = async (text: string) => {
    if (!noteTarget) return;
    setWorkbook(await saveNote(workbook.id, activeWorksheet.id, noteTarget, text));
  };

  /** Removes the note of the open cell; the cell value stays as it was. */
  const removeNote = async () => {
    if (!noteTarget) return;
    setWorkbook(await deleteNote(workbook.id, activeWorksheet.id, noteTarget));
  };

  /**
   * "View" menu items of the current selection: freeze every row through the
   * selected row, every column through the selected column, or the rows above
   * and columns to the left of the selected cell. Each item keeps the other
   * axis as it is, so the frozen state the toolbar button reports is the one
   * the visitor chose.
   */
  const freezeItems = [
    {
      id: "freeze-rows",
      label: `Freeze rows through ${selectionPosition.row}`,
      onSelect: () => void applyFreeze({ rows: selectionPosition.row, columns: freeze.columns }),
    },
    {
      id: "freeze-columns",
      label: `Freeze columns through ${columnName(selectionPosition.column)}`,
      onSelect: () => void applyFreeze({ rows: freeze.rows, columns: selectionPosition.column }),
    },
    {
      id: "freeze-panes",
      label: `Freeze panes at ${cellName(selectionPosition.row, selectionPosition.column)}`,
      onSelect: () =>
        void applyFreeze({ rows: selectionPosition.row - 1, columns: selectionPosition.column - 1 }),
    },
  ];

  const exportCsv = () => {
    // Formula cells export their calculated result, not the expression, and
    // named ranges resolve exactly as they do in the grid.
    downloadTextFile(
      `${workbook.name}.csv`,
      worksheetToCsv({ cells: computeDisplayValues(activeWorksheet.cells, namedRangeResolver) }),
    );
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
          items={[
            { id: "find-and-replace", label: "Find and replace", onSelect: () => setFindReplaceOpen(true) },
          ]}
        />
        <Menu triggerLabel="Insert" items={[{ id: "add-note", label: "Add note", onSelect: () => openNote(selection.anchor) }]} />
        <Menu triggerLabel="View" items={freezeItems} />
        <Button>{`Frozen rows: ${freeze.rows}; columns: ${freeze.columns}`}</Button>
        <Menu
          triggerLabel="Data"
          items={[
            { id: "create-filter", label: "Create filter", onSelect: () => void createFilter() },
            { id: "clear-filter", label: "Clear filter", onSelect: () => void clearActiveFilter() },
            {
              id: "save-filter-view",
              label: "Save filter view",
              disabled: !activeWorksheet.filter,
              onSelect: () => setSaveFilterViewOpen(true),
            },
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
              onSelect: () => setFormattingOpen(true),
            },
          ]}
        />
      </div>
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
          freeze={activeWorksheet.freeze ?? null}
          namedRanges={namedRangeResolver}
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
          onOpenNote={openNote}
        />
      </div>
      {structureError ? <p role="alert">{structureError}</p> : null}
      {freezeError ? <p role="alert">{freezeError}</p> : null}
      {filterError ? <p role="alert">{filterError}</p> : null}
      {sortError ? <p role="alert">{sortError}</p> : null}
      {pivotError ? <p role="alert">{pivotError}</p> : null}
      <FindReplaceDialog
        open={findReplaceOpen}
        cells={activeWorksheet.cells}
        anchor={selection.anchor}
        onSelectCell={(coordinate) => commitSelection(coordinate, coordinate)}
        onReplaceAll={replaceAllCells}
        onOpenChange={setFindReplaceOpen}
      />
      <NamedRangesDialog
        open={namedRangesOpen}
        workbook={workbook}
        activeWorksheetId={activeWorksheet.id}
        onOpenChange={setNamedRangesOpen}
        onSave={storeNamedRange}
      />
      <ConditionalFormattingDialog
        open={formattingOpen}
        range={areaOfRegion(selectionRegion)}
        rules={activeWorksheet.formatRules ?? []}
        onOpenChange={setFormattingOpen}
        onSave={storeFormatRule}
        onDelete={removeFormatRule}
      />
      <NoteDialog
        open={noteTarget !== null}
        coordinate={noteTarget ?? ""}
        note={noteTarget ? activeWorksheet.notes?.[noteTarget] ?? null : null}
        onOpenChange={(open) => {
          if (!open) setNoteTarget(null);
        }}
        onSave={storeNote}
        onDelete={removeNote}
      />
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
          filterTarget ? distinctColumnValues(computeDisplayValues(activeWorksheet.cells, namedRangeResolver), activeWorksheet.filter, filterTarget.column) : []
        }
        rule={filterTarget ? filterColumnFor(activeWorksheet.filter, filterTarget.column) : null}
        onOpenChange={(open) => {
          if (!open) setFilterTarget(null);
        }}
        onApply={applyFilterColumn}
      />
      <SaveFilterViewDialog
        open={saveFilterViewOpen}
        onOpenChange={setSaveFilterViewOpen}
        onSave={saveCurrentFilterView}
      />
      <FilterViewsDialog
        open={filterViewsOpen}
        views={activeWorksheet.filterViews ?? []}
        onOpenChange={setFilterViewsOpen}
        onApply={applyFilterView}
        onDelete={removeFilterView}
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
    </>
  );
}

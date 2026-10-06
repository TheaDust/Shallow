import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "../ui/Button";
import { CellNoteDialog } from "../components/CellNoteDialog";
import { CreatePivotDialog } from "../components/CreatePivotDialog";
import { ConditionalFormattingDialog } from "../components/ConditionalFormattingDialog";
import { DataValidationDialog } from "../components/DataValidationDialog";
import { EditorToolbar } from "../components/EditorToolbar";
import { FindReplaceDialog } from "../components/FindReplaceDialog";
import { FilterDialog } from "../components/FilterDialog";
import { FilterViewsDialog } from "../components/FilterViewsDialog";
import { FormulaBar } from "../components/FormulaBar";
import { NamedRangesDialog, type NamedRangeDraft } from "../components/NamedRangesDialog";
import { PivotTableEditor } from "../components/PivotTableEditor";
import { RenameWorkbookDialog } from "../components/RenameWorkbookDialog";
import { SaveFilterViewDialog } from "../components/SaveFilterViewDialog";
import { SortRangeDialog } from "../components/SortRangeDialog";
import { WorksheetGrid, type StructureDirection } from "../components/WorksheetGrid";
import { GRID_PANEL_ID, WorksheetTabsPanel } from "../components/WorksheetTabsPanel";
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
import {
  dataRegionAround,
  distinctColumnValues,
  emptyFilter,
  filterColumnFor,
  headerColumns,
} from "../domain/filter";
import { pivotFieldError, pivotFieldOptions } from "../domain/pivot";
import { sortColumns, type SortColumn } from "../domain/sort";
import { cellName, formatLastUpdated, parseCellName, regionBetween, type CellRegion } from "../domain/grid";
import { sheetCellMaps } from "../domain/named-ranges";
import type {
  FilterColumn,
  FilterView,
  PivotConfig,
  ValidationRule,
  Workbook,
  WorksheetSelection,
} from "../domain/types";
import { findRuleForRegion } from "../domain/validation";
import type { ConditionalFormatDraft } from "../components/ConditionalFormattingDialog";
import { makeHash } from "../lib/hash-route";
import { downloadTextFile } from "../lib/download";
import {
  applyCellRange,
  applyFilterView,
  applyPivotConfig,
  changeStructure,
  clearFilter,
  createPivotTable,
  deleteConditionalFormat,
  deleteFilterView,
  deleteNote,
  deleteValidationRule,
  fetchWorkbook,
  refreshPivotTable,
  renameWorkbook,
  replaceCells,
  replaceWorksheetState,
  saveConditionalFormat,
  saveFilter,
  saveFilterView,
  saveNamedRange,
  saveNote,
  saveValidationRule,
  selectRange,
  setFreeze,
  sortRange,
  transferRange,
  updateCell,
  type StructureAxis,
  type StructureMode,
} from "../lib/workbook-api";
import { snapshotWorksheet, useWorksheetHistory, type WorksheetSnapshot } from "./useWorksheetHistory";

const DEFAULT_SELECTION: WorksheetSelection = { anchor: "A1", focus: "A1" };

/** A copied or cut range of one worksheet, kept for the current session only. */
interface InternalClipboard {
  mode: "copy" | "cut";
  worksheetId: string;
  region: CellRegion;
  rows: string[][];
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
  const [namedRangesOpen, setNamedRangesOpen] = useState(false);
  const [conditionalFormattingOpen, setConditionalFormattingOpen] = useState(false);
  const [cellError, setCellError] = useState<string | null>(null);
  const [structureError, setStructureError] = useState<string | null>(null);
  const [validationOpen, setValidationOpen] = useState(false);
  const [filterTarget, setFilterTarget] = useState<{ column: number; header: string } | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [saveFilterViewOpen, setSaveFilterViewOpen] = useState(false);
  const [filterViewsOpen, setFilterViewsOpen] = useState(false);
  /** Id of the view chosen in the "Filter views" interface, or `null`. */
  const [selectedFilterViewId, setSelectedFilterViewId] = useState<string | null>(null);
  const [pivotError, setPivotError] = useState<string | null>(null);
  const [pivotDialogOpen, setPivotDialogOpen] = useState(false);
  const [pivotSourceRange, setPivotSourceRange] = useState("");
  /** Range and column options of the open "Sort range" dialog, or `null`. */
  const [sortTarget, setSortTarget] = useState<{ range: string; columns: SortColumn[] } | null>(null);
  const [sortError, setSortError] = useState<string | null>(null);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  /** Worksheet and coordinate of the cell whose note interface is open, or `null`. */
  const [noteTarget, setNoteTarget] = useState<{ worksheetId: string; coordinate: string } | null>(null);
  const [clipboardFilled, setClipboardFilled] = useState(false);
  /** Last raw text sent per `worksheetId:coordinate`, used to drop stale saves. */
  const pendingCellWrites = useRef(new Map<string, string>());
  const clipboardRef = useRef<InternalClipboard | null>(null);
  const history = useWorksheetHistory(workbookId);
  // Saved names are part of every calculation of this workbook, so the grid and
  // the CSV export resolve them exactly like the persisted state does.
  const formulaContext = useMemo(
    () => ({
      namedRanges: workbook?.namedRanges ?? [],
      sheets: sheetCellMaps(workbook?.worksheets ?? []),
      sheetName: workbook?.worksheets.find((candidate) => candidate.id === workbook.activeWorksheetId)?.name,
    }),
    [workbook],
  );

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
  // The active cell drives the "View" menu wording and the frozen-panes button
  // reports what the server stored for this worksheet (0/0 when unfrozen).
  const anchorPosition = parseCellName(selection.anchor) ?? { row: 1, column: 1 };
  const frozen = activeWorksheet.freeze ?? { rows: 0, columns: 0 };
  // A pivot worksheet shows which source worksheet and headers it reads: the
  // options of its editor and the error of a field the source no longer has.
  const pivot = activeWorksheet.pivot ?? null;
  const pivotSourceWorksheet = pivot
    ? workbook.worksheets.find((worksheet) => worksheet.id === pivot.sourceWorksheetId)
    : undefined;
  const pivotHeaders = pivot ? pivotFieldOptions(pivotSourceWorksheet, pivot.range) : [];
  // The chosen view stays selected while it exists; a view deleted elsewhere or
  // on another worksheet leaves the interface without a selection.
  const savedFilterViews = workbook.filterViews ?? [];
  const selectedViewId = savedFilterViews.some((view) => view.id === selectedFilterViewId)
    ? selectedFilterViewId
    : null;
  // The open note dialog reads the stored note of its own worksheet, so the
  // text it shows and replaces belongs to the cell it was opened from.
  const noteText = noteTarget
    ? workbook.worksheets.find((worksheet) => worksheet.id === noteTarget.worksheetId)?.notes?.[
        noteTarget.coordinate
      ] ?? null
    : null;

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

  const saveName = async (name: string) => {
    setWorkbook(await renameWorkbook(workbook.id, name));
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
   * Clears every cell of the current selected rectangle (the Delete key). The
   * whole rectangle is cleared in one atomic request through the bulk cell
   * endpoint, so clearing a formula drops its stored expression and the
   * directly and indirectly dependent formulas recalculate from the remaining
   * cells. The selection is not touched, and a failed clear reports an error
   * and puts the last successful values back, leaving dependent results
   * unchanged.
   */
  const clearSelection = () => {
    const worksheetId = activeWorksheet.id;
    // One empty text per cell of the selected rectangle, in row-major order.
    const rows = rowsFromRegion({}, selectionRegion);
    if (rows.length === 0) return;
    const previousCells = activeWorksheet.cells;
    const before = snapshotWorksheet(activeWorksheet);
    setCellError(null);
    setWorkbook((current) =>
      current
        ? withWorksheet(current, worksheetId, (worksheet) => {
            const cells = { ...worksheet.cells };
            for (const { coordinate } of rectangleCells(selectionStart, rows)) delete cells[coordinate];
            return { ...worksheet, cells };
          })
        : current,
    );
    applyCellRange(workbook.id, worksheetId, selectionStart, rows)
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
    const display = computeDisplayValues(activeWorksheet.cells, formulaContext);
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
   * Opens the save interface of the applied filter. Only the filter currently
   * in effect can be saved, so a worksheet without one reports that instead of
   * offering a name for criteria that do not exist.
   */
  const openSaveFilterView = () => {
    setFilterError(null);
    if (!activeWorksheet.filter) {
      setFilterError("Create a filter before saving a filter view");
      return;
    }
    setSaveFilterViewOpen(true);
  };

  /**
   * Saves the applied filter under the entered name. The server trims the name
   * and keeps it unique inside the workbook; a rejected save (its message is
   * shown in the dialog) leaves both the applied filter and the saved views as
   * they were, and the dialog stays open for another name.
   */
  const storeFilterView = async (name: string) => {
    const current = activeWorksheet.filter;
    if (!current) throw new Error("Create a filter before saving a filter view");
    setWorkbook(await saveFilterView(workbook.id, name, current));
  };

  /** Opens the view-management interface; the last chosen view stays selected. */
  const openFilterViews = () => {
    setFilterError(null);
    setFilterViewsOpen(true);
  };

  /**
   * Chooses a saved view: its criteria replace the worksheet's current filters
   * in one atomic write, so exactly the rows of that view stay visible while
   * every other record keeps its value and position.
   */
  const chooseFilterView = async (view: FilterView) => {
    setWorkbook(await applyFilterView(workbook.id, activeWorksheet.id, view.id));
    setSelectedFilterViewId(view.id);
  };

  /**
   * Deletes the chosen view and restores every source row of the worksheet in
   * the same atomic write; the grid keeps its values and their order.
   */
  const removeFilterView = async () => {
    if (!selectedFilterViewId) return;
    setWorkbook(await deleteFilterView(workbook.id, activeWorksheet.id, selectedFilterViewId));
    setSelectedFilterViewId(null);
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
    const display = computeDisplayValues(activeWorksheet.cells, formulaContext);
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
   * Persists the note of one cell. Notes are kept next to the cells, so saving
   * one never changes the cell value; a rejected save keeps the cell's last
   * stored note and the dialog reports the message.
   */
  const storeNote = async (text: string) => {
    if (!noteTarget) return;
    setWorkbook(await saveNote(workbook.id, noteTarget.worksheetId, noteTarget.coordinate, text));
  };

  /** Removes the note of one cell together with its open button. */
  const removeNote = async () => {
    if (!noteTarget) return;
    setWorkbook(await deleteNote(workbook.id, noteTarget.worksheetId, noteTarget.coordinate));
  };

  const exportCsv = () => {
    // Formula cells export their calculated result, not the expression.
    downloadTextFile(
      `${workbook.name}.csv`,
      worksheetToCsv({ cells: computeDisplayValues(activeWorksheet.cells, formulaContext) }),
    );
  };

  /**
   * Persists the frozen panes of the active worksheet. The stored counts are
   * what the editor's frozen-panes button shows and what a refresh restores; a
   * rejected write reports its message and leaves the last saved state in
   * place.
   */
  const applyFreeze = async (rows: number, columns: number) => {
    setCellError(null);
    try {
      setWorkbook(await setFreeze(workbook.id, activeWorksheet.id, { rows, columns }));
    } catch (caught) {
      setCellError(caught instanceof Error ? caught.message : "Unable to freeze the panes");
    }
  };

  /**
   * Persists a named range (a new name or the edited range of a stored one).
   * The server validates the name and the range before its atomic write, so a
   * rejected save leaves every stored name as it was.
   */
  const storeNamedRange = async (draft: NamedRangeDraft) => {
    setWorkbook(await saveNamedRange(workbook.id, draft));
  };

  /** Persists one conditional formatting rule; an edit replaces that rule. */
  const storeConditionalFormat = async (draft: ConditionalFormatDraft) => {
    setWorkbook(await saveConditionalFormat(workbook.id, activeWorksheet.id, draft));
  };

  /** Removes one rule of the active worksheet, so its cells lose the fill. */
  const removeConditionalFormat = async (id: string) => {
    setWorkbook(await deleteConditionalFormat(workbook.id, activeWorksheet.id, id));
  };

  /**
   * Writes every replacement of "Replace all" in one atomic request. A rejected
   * replacement keeps the message for the dialog and leaves the grid unchanged;
   * a success replaces the stored worksheet and stays undoable.
   */
  const replaceMatchingCells = async (updates: Array<{ coordinate: string; value: string }>) => {
    const before = snapshotWorksheet(activeWorksheet);
    const saved = await replaceCells(workbook.id, activeWorksheet.id, updates);
    setWorkbook(saved);
    history.record(before);
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
      <EditorToolbar
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        anchor={anchorPosition}
        frozen={frozen}
        onUndo={undo}
        onRedo={redo}
        onCopy={() => captureSelection("copy")}
        onCut={() => captureSelection("cut")}
        onPaste={() => void pasteCommand(selectionStart)}
        onExport={exportCsv}
        onFindReplace={() => setFindReplaceOpen(true)}
        onAddNote={() => setNoteTarget({ worksheetId: activeWorksheet.id, coordinate: selection.anchor })}
        onFreeze={(rows, columns) => void applyFreeze(rows, columns)}
        onCreateFilter={() => void createFilter()}
        onClearFilter={() => void clearActiveFilter()}
        onSaveFilterView={openSaveFilterView}
        onFilterViews={openFilterViews}
        onSortRange={openSort}
        onDataValidation={() => setValidationOpen(true)}
        onCreatePivot={openCreatePivot}
        onNamedRanges={() => setNamedRangesOpen(true)}
        onConditionalFormatting={() => setConditionalFormattingOpen(true)}
      />
      <WorksheetTabsPanel workbook={workbook} onWorkbookChange={setWorkbook} />
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
          freeze={frozen}
          formulaContext={formulaContext}
          clipboardFilled={clipboardFilled}
          onSelectRange={updateSelection}
          onSelectionCommit={commitSelection}
          onEditCell={(coordinate, value) => commitCell(activeWorksheet.id, coordinate, value)}
          onClearSelection={clearSelection}
          onPaste={handlePaste}
          onPasteCommand={pasteCommand}
          onCopy={() => captureSelection("copy")}
          onCut={() => captureSelection("cut")}
          onUndo={undo}
          onRedo={redo}
          onInsert={insertLine}
          onDelete={deleteLine}
          onOpenNote={(coordinate) => setNoteTarget({ worksheetId: activeWorksheet.id, coordinate })}
          onFilter={(column, header) => {
            setFilterError(null);
            setFilterTarget({ column, header });
          }}
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
      <NamedRangesDialog
        open={namedRangesOpen}
        namedRanges={workbook.namedRanges ?? []}
        onOpenChange={setNamedRangesOpen}
        onSave={storeNamedRange}
      />
      <ConditionalFormattingDialog
        open={conditionalFormattingOpen}
        range={areaOfRegion(selectionRegion)}
        rules={activeWorksheet.conditionalFormats ?? []}
        onOpenChange={setConditionalFormattingOpen}
        onSave={storeConditionalFormat}
        onDelete={removeConditionalFormat}
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
          filterTarget ? distinctColumnValues(computeDisplayValues(activeWorksheet.cells, formulaContext), activeWorksheet.filter, filterTarget.column) : []
        }
        rule={filterTarget ? filterColumnFor(activeWorksheet.filter, filterTarget.column) : null}
        onOpenChange={(open) => {
          if (!open) setFilterTarget(null);
        }}
        onApply={applyFilterColumn}
      />
      <SaveFilterViewDialog open={saveFilterViewOpen} onOpenChange={setSaveFilterViewOpen} onSave={storeFilterView} />
      <FindReplaceDialog
        open={findReplaceOpen}
        onOpenChange={setFindReplaceOpen}
        displayValues={computeDisplayValues(activeWorksheet.cells, formulaContext)}
        selectionAnchor={selection.anchor}
        onSelectCell={(coordinate) => commitSelection(coordinate, coordinate)}
        onReplaceCells={replaceMatchingCells}
      />
      <FilterViewsDialog
        open={filterViewsOpen}
        views={workbook.filterViews ?? []}
        selectedId={selectedViewId}
        onOpenChange={setFilterViewsOpen}
        onChoose={chooseFilterView}
        onDelete={removeFilterView}
      />
      <CellNoteDialog
        open={noteTarget !== null}
        coordinate={noteTarget?.coordinate ?? selection.anchor}
        note={noteText}
        onOpenChange={(open) => {
          if (!open) setNoteTarget(null);
        }}
        onSave={storeNote}
        onDelete={removeNote}
      />
      <SortRangeDialog
        open={sortTarget !== null}
        columns={sortTarget?.columns ?? []}
        onOpenChange={(open) => {
          if (!open) setSortTarget(null);
        }}
        onSort={applySort}
      />
    </>
  );
}

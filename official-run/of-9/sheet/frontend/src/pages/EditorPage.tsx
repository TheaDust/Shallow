import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearClipboardBuffer,
  getClipboardBuffer,
  getLastExternalText,
  parsePasteText,
  serializePasteText,
  setClipboardBuffer,
  setLastExternalText,
} from "../domain/clipboard";
import {
  canRedo,
  canUndo,
  clearRedo,
  popRedo,
  popUndo,
  pushRedo,
  pushUndo,
  snapshotSheet,
  type SheetSnapshot,
} from "../domain/history";
import {
  cellCoordinate,
  clampSelection,
  formatUpdated,
  gridDimensions,
  normalizeSelection,
  singleCellSelection,
  type GridPosition,
  type GridSelection,
} from "../domain/grid";
import { buildHiddenRows, columnFilterFor, distinctValues, formatCellRange } from "../domain/filter";
import { rangeHeaders, ruleForSelection } from "../domain/validation";
import type { CellRange, ColumnFilter, SummarizeBy, Workbook, Worksheet } from "../domain/types";
import {
  addWorksheet,
  applyPivot,
  changeSheetStructure,
  createPivot,
  exportWorkbookUrl,
  getWorkbook,
  refreshPivot,
  restoreSheet,
  setActiveSheet,
  setFilter,
  setSheetSelection,
  transferRange,
  updateCells,
  type SheetStructureOp,
} from "../lib/api";
import { makeHash } from "../lib/hash-route";
import { Button, Menu } from "../ui";
import { RenameWorkbookDialog } from "../components/RenameWorkbookDialog";
import { RenameWorksheetDialog } from "../components/RenameWorksheetDialog";
import { DeleteWorksheetDialog } from "../components/DeleteWorksheetDialog";
import { useWorksheetDeletion } from "../components/useWorksheetDeletion";
import { WorksheetGrid } from "../components/WorksheetGrid";
import { WorksheetTabBar } from "../components/WorksheetTabBar";
import { FilterDialog } from "../components/FilterDialog";
import { PivotCreateDialog } from "../components/PivotCreateDialog";
import { PivotEditor } from "../components/PivotEditor";
import { DataValidationDialog } from "../components/DataValidationDialog";
import { SortRangeDialog } from "../components/SortRangeDialog";

const NO_HIDDEN_ROWS: ReadonlySet<number> = new Set();
const NO_FILTER_HEADERS: ReadonlyArray<{ row: number; column: number }> = [];

export interface EditorPageProps {
  workbookId: string;
}

function triggerDownload(url: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function initialSelectionForSheet(sheet: Worksheet): GridSelection {
  if (sheet.selection) {
    const { rows, columns } = gridDimensions(sheet.cells);
    return clampSelection(normalizeSelection(sheet.selection), rows, columns);
  }
  return singleCellSelection(1, 1);
}

export function EditorPage({ workbookId }: EditorPageProps) {
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameSheetTarget, setRenameSheetTarget] = useState<Worksheet | null>(null);
  const [operationBusy, setOperationBusy] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [selection, setSelection] = useState<GridSelection>(singleCellSelection(1, 1));
  const [formulaDraft, setFormulaDraft] = useState<string | null>(null);
  const [filterColumn, setFilterColumn] = useState<number | null>(null);
  const [pivotCreateOpen, setPivotCreateOpen] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [, setHistoryTick] = useState(0);
  const workbookRef = useRef<Workbook | null>(null);
  const sheetSelectionsRef = useRef<Record<string, GridSelection>>({});
  const formulaDraftRef = useRef<string | null>(null);
  /** Per-sheet pending selection saves: undefined = idle, null = in flight, otherwise queued. */
  const pendingSelectionSaveRef = useRef<Record<string, GridSelection | null>>({});
  const performUndoRef = useRef<() => void>(() => {});
  const performRedoRef = useRef<() => void>(() => {});
  /** Snapshots captured when the validation / sort dialogs open, for undo. */
  const validationBeforeRef = useRef<{ sheetId: string; before: SheetSnapshot } | null>(null);
  const sortBeforeRef = useRef<{ sheetId: string; before: SheetSnapshot } | null>(null);

  const updateFormulaDraft = (value: string | null) => {
    formulaDraftRef.current = value;
    setFormulaDraft(value);
  };

  const worksheetDeletion = useWorksheetDeletion({
    getWorkbook: () => workbookRef.current,
    busy: operationBusy,
    setBusy: setOperationBusy,
    setError: setOperationError,
    setWorkbook,
    sheetSelectionsRef,
    setSelection,
    resetFormulaDraft: () => updateFormulaDraft(null),
  });

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const loaded = await getWorkbook(workbookId);
      const map: Record<string, GridSelection> = {};
      for (const sheet of loaded.sheets) {
        map[sheet.id] = initialSelectionForSheet(sheet);
      }
      sheetSelectionsRef.current = map;
      setWorkbook(loaded);
      const active = loaded.sheets.find((sheet) => sheet.id === loaded.activeSheetId) ?? loaded.sheets[0];
      setSelection(map[active.id] ?? singleCellSelection(1, 1));
      updateFormulaDraft(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load workbook");
    } finally {
      setBusy(false);
    }
  }, [workbookId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    workbookRef.current = workbook;
  }, [workbook]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (target.closest?.('[role="menu"], [role="dialog"]')) return;
      event.preventDefault();
      if (key === "z" && !event.shiftKey) {
        performUndoRef.current();
      } else {
        performRedoRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * Persists a worksheet selection immediately. At most one request is in
   * flight per sheet; newer selections queue up and are saved as soon as the
   * in-flight request settles, so the last selection always reaches the
   * store (and survives an immediate reload).
   */
  const persistSelection = useCallback((sheetId: string) => {
    const pending = pendingSelectionSaveRef.current[sheetId];
    if (pending === undefined || pending === null) return;
    pendingSelectionSaveRef.current[sheetId] = null; // mark in flight
    const wb = workbookRef.current;
    if (!wb) return;
    void setSheetSelection(wb.id, sheetId, pending)
      .catch(() => {
        // Keep the local selection; persistence keeps the last successful save.
      })
      .finally(() => {
        const latest = pendingSelectionSaveRef.current[sheetId];
        if (latest === undefined || latest === null) {
          delete pendingSelectionSaveRef.current[sheetId];
        } else {
          void persistSelection(sheetId);
        }
      });
  }, []);

  const scheduleSelectionSave = useCallback(
    (next: GridSelection) => {
      const wb = workbookRef.current;
      if (!wb) return;
      const sheet = wb.sheets.find((item) => item.id === wb.activeSheetId);
      if (!sheet) return;
      const sheetId = sheet.id;
      const normalized = normalizeSelection(next);
      const pending = pendingSelectionSaveRef.current[sheetId];
      if (pending !== undefined && pending !== null && JSON.stringify(pending) === JSON.stringify(normalized)) {
        return;
      }
      if (pending === null) {
        // A request is in flight; queue the newest selection for the next round.
        pendingSelectionSaveRef.current[sheetId] = normalized;
        return;
      }
      pendingSelectionSaveRef.current[sheetId] = normalized;
      void persistSelection(sheetId);
    },
    [persistSelection],
  );

  if (busy) {
    return (
      <main className="editor-page">
        <p role="status">Loading workbook…</p>
      </main>
    );
  }

  if (error || !workbook) {
    return (
      <main className="editor-page">
        <p role="alert">{error ?? "Workbook not found"}</p>
        <p>
          <a href={makeHash("/")}>Back to workbooks</a>
        </p>
      </main>
    );
  }

  const activeSheet = workbook.sheets.find((sheet) => sheet.id === workbook.activeSheetId) ?? workbook.sheets[0];
  const activeCell = activeSheet.cells[cellCoordinate(selection.start.row, selection.start.column)];
  const activeContent = activeCell ? (activeCell.formula ?? activeCell.value) : "";
  const formulaBarValue = formulaDraft ?? activeContent;

  const activeFilterView = activeSheet.filterViews?.[0] ?? null;
  const hiddenRows = activeFilterView ? buildHiddenRows(activeSheet.cells, activeFilterView) : NO_HIDDEN_ROWS;
  const filterHeaderCells = activeFilterView
    ? Array.from(
        { length: activeFilterView.range.end.column - activeFilterView.range.start.column + 1 },
        (_, offset) => ({ row: activeFilterView.range.start.row, column: activeFilterView.range.start.column + offset }),
      )
    : NO_FILTER_HEADERS;
  const pivotConfig = activeSheet.pivot ?? null;
  const pivotHeaders = pivotConfig
    ? (() => {
        const source = workbook.sheets.find((sheet) => sheet.id === pivotConfig.sourceSheetId);
        if (!source) return [];
        const headers: string[] = [];
        for (let column = pivotConfig.sourceRange.start.column; column <= pivotConfig.sourceRange.end.column; column += 1) {
          headers.push(source.cells[cellCoordinate(pivotConfig.sourceRange.start.row, column)]?.value ?? "");
        }
        return headers;
      })()
    : [];
  const pivotError = pivotConfig
    ? pivotConfig.broken ||
      [pivotConfig.rowField, pivotConfig.valueField, pivotConfig.columnField]
        .filter((field): field is string => Boolean(field))
        .some((field) => !pivotHeaders.includes(field))
      ? "Pivot field is no longer available. Select a new field."
      : (pivotConfig.lastError ?? null)
    : null;
  const selectedRange = normalizeSelection(selection);
  const existingValidationRule = ruleForSelection(activeSheet.validationRules, selection);
  const sortHeaders = rangeHeaders(activeSheet.cells, selectedRange);
  const filterDialogValues =
    filterColumn !== null && activeFilterView ? distinctValues(activeSheet.cells, activeFilterView.range, filterColumn) : [];
  const filterDialogCurrent =
    filterColumn !== null && activeFilterView ? columnFilterFor(activeFilterView, filterColumn) : null;
  const filterDialogHeader =
    filterColumn !== null && activeFilterView
      ? (activeSheet.cells[cellCoordinate(activeFilterView.range.start.row, filterColumn)]?.value ?? "")
      : "";

  const handleSelect = (next: GridSelection) => {
    const wb = workbookRef.current;
    if (!wb) return;
    const sheet = wb.sheets.find((item) => item.id === wb.activeSheetId);
    if (!sheet) return;
    sheetSelectionsRef.current[sheet.id] = next;
    setSelection(next);
    scheduleSelectionSave(next);
  };

  const commitCell = async (row: number, column: number, rawValue: string) => {
    const wb = workbookRef.current;
    if (!wb) return;
    const sheet = wb.sheets.find((item) => item.id === wb.activeSheetId) ?? wb.sheets[0];
    const coordinate = cellCoordinate(row, column);
    const current = sheet.cells[coordinate];
    const currentContent = current ? (current.formula ?? current.value) : "";
    if (rawValue === currentContent) return;
    const before = snapshotSheet(sheet);
    setOperationBusy(true);
    setOperationError(null);
    try {
      const updated = await updateCells(wb.id, sheet.id, { [coordinate]: rawValue });
      setWorkbook(updated);
      recordOperation(sheet.id, before, updated);
    } catch (caught) {
      setOperationError(caught instanceof Error ? caught.message : "Failed to update cell");
    } finally {
      setOperationBusy(false);
      updateFormulaDraft(null);
    }
  };

  const commitFormulaBar = (value: string) => {
    if (value === activeContent) {
      updateFormulaDraft(null);
      return;
    }
    void commitCell(selection.start.row, selection.start.column, value);
  };

  const handleTabChange = async (sheetId: string) => {
    if (sheetId === workbook.activeSheetId) return;
    const previous = workbook;
    const previousSelection = selection;
    const target = workbook.sheets.find((sheet) => sheet.id === sheetId) ?? workbook.sheets[0];
    setWorkbook({ ...workbook, activeSheetId: sheetId });
    setSelection(sheetSelectionsRef.current[sheetId] ?? initialSelectionForSheet(target));
    updateFormulaDraft(null);
    try {
      const updated = await setActiveSheet(workbook.id, sheetId);
      setWorkbook(updated);
    } catch (caught) {
      // The switch failed: stay on the source worksheet and restore its
      // most recent successful selection and formula bar state.
      setWorkbook(previous);
      setSelection(previousSelection);
      updateFormulaDraft(null);
      setOperationError(caught instanceof Error ? caught.message : "Failed to switch worksheet");
    }
  };

  const handleAddSheet = async () => {
    if (operationBusy) return;
    setOperationBusy(true);
    setOperationError(null);
    try {
      const updated = await addWorksheet(workbook.id);
      sheetSelectionsRef.current[updated.activeSheetId] = singleCellSelection(1, 1);
      setWorkbook(updated);
      setSelection(singleCellSelection(1, 1));
      updateFormulaDraft(null);
    } catch (caught) {
      setOperationError(caught instanceof Error ? caught.message : "Failed to add worksheet");
    } finally {
      setOperationBusy(false);
    }
  };

  const handleRenameSheet = (sheet: Worksheet) => {
    setRenameSheetTarget(sheet);
  };

  const handleSheetStructure = async (op: SheetStructureOp, index: number) => {
    if (operationBusy) return;
    const wb = workbookRef.current;
    if (!wb) return;
    const sheet = wb.sheets.find((item) => item.id === wb.activeSheetId) ?? wb.sheets[0];
    const before = snapshotSheet(sheet);
    setOperationBusy(true);
    setOperationError(null);
    try {
      const updated = await changeSheetStructure(wb.id, sheet.id, op, index);
      setWorkbook(updated);
      recordOperation(sheet.id, before, updated);
      const updatedActive = updated.sheets.find((item) => item.id === sheet.id) ?? updated.sheets[0];
      const { rows, columns } = gridDimensions(updatedActive.cells);
      const next = clampSelection(selection, rows, columns);
      sheetSelectionsRef.current[sheet.id] = next;
      setSelection(next);
      scheduleSelectionSave(next);
    } catch (caught) {
      setOperationError(caught instanceof Error ? caught.message : "Failed to update sheet structure");
    } finally {
      setOperationBusy(false);
    }
  };

  const writeSystemClipboard = (sheet: Worksheet) => {
    const normalized = normalizeSelection(selection);
    const table: string[][] = [];
    for (let row = normalized.start.row; row <= normalized.end.row; row += 1) {
      const line: string[] = [];
      for (let column = normalized.start.column; column <= normalized.end.column; column += 1) {
        const cell = sheet.cells[cellCoordinate(row, column)];
        line.push(cell ? (cell.formula ?? cell.value) : "");
      }
      table.push(line);
    }
    const text = serializePasteText(table);
    setLastExternalText(text);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(text).catch(() => {
          // Clipboard access may be unavailable; the internal buffer still works.
        });
      }
    } catch {
      // Ignore clipboard permission failures.
    }
  };

  const handleCopy = () => {
    const wb = workbookRef.current;
    if (!wb) return;
    const sheet = wb.sheets.find((item) => item.id === wb.activeSheetId) ?? wb.sheets[0];
    setClipboardBuffer({ sheetId: sheet.id, source: normalizeSelection(selection), mode: "copy" });
    writeSystemClipboard(sheet);
  };

  const handleCut = () => {
    const wb = workbookRef.current;
    if (!wb) return;
    const sheet = wb.sheets.find((item) => item.id === wb.activeSheetId) ?? wb.sheets[0];
    setClipboardBuffer({ sheetId: sheet.id, source: normalizeSelection(selection), mode: "cut" });
    writeSystemClipboard(sheet);
  };

  const doTransfer = async (source: CellRange, target: GridPosition, mode: "copy" | "cut") => {
    const wb = workbookRef.current;
    if (!wb) return;
    const sheet = wb.sheets.find((item) => item.id === wb.activeSheetId) ?? wb.sheets[0];
    const before = snapshotSheet(sheet);
    setOperationBusy(true);
    setOperationError(null);
    try {
      const updated = await transferRange(wb.id, sheet.id, {
        source: normalizeSelection(source),
        target: { start: target, end: target },
        mode,
      });
      setWorkbook(updated);
      recordOperation(sheet.id, before, updated);
      const updatedSheet = updated.sheets.find((item) => item.id === sheet.id) ?? updated.sheets[0];
      const { rows, columns } = gridDimensions(updatedSheet.cells);
      const src = normalizeSelection(source);
      const pasted = clampSelection(
        {
          start: target,
          end: {
            row: target.row + (src.end.row - src.start.row),
            column: target.column + (src.end.column - src.start.column),
          },
        },
        rows,
        columns,
      );
      sheetSelectionsRef.current[sheet.id] = pasted;
      setSelection(pasted);
      scheduleSelectionSave(pasted);
    } catch (caught) {
      setOperationError(caught instanceof Error ? caught.message : "Failed to paste");
    } finally {
      setOperationBusy(false);
    }
  };

  const pasteExternalText = async (text: string, start: GridPosition) => {
    const wb = workbookRef.current;
    if (!wb) return;
    const sheet = wb.sheets.find((item) => item.id === wb.activeSheetId) ?? wb.sheets[0];
    const rows = parsePasteText(text);
    if (rows.length === 0 || (rows.length === 1 && rows[0].length === 1 && rows[0][0] === "")) return;
    const cellsMap: Record<string, string> = {};
    let maxColumns = 1;
    rows.forEach((row, rowIndex) => {
      maxColumns = Math.max(maxColumns, row.length);
      row.forEach((field, columnIndex) => {
        cellsMap[cellCoordinate(start.row + rowIndex, start.column + columnIndex)] = field;
      });
    });
    const before = snapshotSheet(sheet);
    setOperationBusy(true);
    setOperationError(null);
    try {
      const updated = await updateCells(wb.id, sheet.id, cellsMap);
      setWorkbook(updated);
      recordOperation(sheet.id, before, updated);
      const updatedSheet = updated.sheets.find((item) => item.id === sheet.id) ?? updated.sheets[0];
      const { rows: gridRows, columns: gridColumns } = gridDimensions(updatedSheet.cells);
      const pasted = clampSelection(
        { start, end: { row: start.row + rows.length - 1, column: start.column + maxColumns - 1 } },
        gridRows,
        gridColumns,
      );
      sheetSelectionsRef.current[sheet.id] = pasted;
      setSelection(pasted);
      scheduleSelectionSave(pasted);
    } catch (caught) {
      setOperationError(caught instanceof Error ? caught.message : "Failed to paste");
    } finally {
      setOperationBusy(false);
    }
  };

  const handlePasteText = (text: string, start: GridPosition) => {
    void pasteExternalText(text, start);
  };

  /**
   * Reads the operating-system clipboard (the same content Ctrl+V pastes).
   * Resolves to "" when the browser blocks clipboard access.
   */
  const readExternalClipboard = async (): Promise<string> => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.readText) return "";
    try {
      return await navigator.clipboard.readText();
    } catch {
      return "";
    }
  };

  const handlePasteBuffer = () => {
    const buffer = getClipboardBuffer();
    const wb = workbookRef.current;
    if (!wb) return;
    if (!buffer) {
      const external = getLastExternalText();
      if (external) {
        void pasteExternalText(external, selection.start);
        return;
      }
      // No in-app copy/cut and no previously seen paste event: the context-menu
      // Paste command must still paste the external clipboard content that
      // Ctrl+V would paste, so read the OS clipboard.
      void readExternalClipboard()
        .then((text) => {
          if (text && text.trim() !== "") {
            setLastExternalText(text);
            void pasteExternalText(text, selection.start);
          } else {
            setOperationError("Nothing to paste");
          }
        })
        .catch(() => {
          setOperationError("Nothing to paste");
        });
      return;
    }
    const sheet = wb.sheets.find((item) => item.id === wb.activeSheetId) ?? wb.sheets[0];
    if (buffer.sheetId !== sheet.id) {
      setOperationError("Paste is only supported within the same worksheet");
      return;
    }
    void doTransfer(buffer.source, selection.start, buffer.mode).then(() => {
      if (buffer.mode === "cut") clearClipboardBuffer();
    });
  };

  const exportCsv = () => {
    triggerDownload(exportWorkbookUrl(workbook.id), `${workbook.name}.csv`);
  };

  /** Records a successful modification for undo; a new modification drops redo. */
  const recordOperation = (sheetId: string, before: SheetSnapshot, updated: Workbook) => {
    const afterSheet = updated.sheets.find((item) => item.id === sheetId) ?? updated.sheets[0];
    const after = snapshotSheet(afterSheet);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    pushUndo(updated.id, { sheetId, before, after });
    clearRedo(updated.id);
    setHistoryTick((tick) => tick + 1);
  };

  const handleCreateFilter = async () => {
    if (operationBusy) return;
    const wb = workbookRef.current;
    if (!wb) return;
    const sheet = wb.sheets.find((item) => item.id === wb.activeSheetId);
    if (!sheet) return;
    const before = snapshotSheet(sheet);
    setOperationBusy(true);
    setOperationError(null);
    try {
      const updated = await setFilter(wb.id, sheet.id, { range: normalizeSelection(selection) });
      setWorkbook(updated);
      recordOperation(sheet.id, before, updated);
    } catch (caught) {
      setOperationError(caught instanceof Error ? caught.message : "Failed to create filter");
    } finally {
      setOperationBusy(false);
    }
  };

  const handleClearFilter = async () => {
    if (operationBusy) return;
    const wb = workbookRef.current;
    if (!wb) return;
    const sheet = wb.sheets.find((item) => item.id === wb.activeSheetId);
    if (!sheet) return;
    const before = snapshotSheet(sheet);
    setOperationBusy(true);
    setOperationError(null);
    try {
      const updated = await setFilter(wb.id, sheet.id, { clear: true });
      setWorkbook(updated);
      recordOperation(sheet.id, before, updated);
    } catch (caught) {
      setOperationError(caught instanceof Error ? caught.message : "Failed to clear filter");
    } finally {
      setOperationBusy(false);
    }
  };

  const handleApplyFilter = async (filter: ColumnFilter) => {
    if (operationBusy) return;
    const wb = workbookRef.current;
    if (!wb) return;
    const sheet = wb.sheets.find((item) => item.id === wb.activeSheetId);
    if (!sheet) return;
    const view = sheet.filterViews?.[0];
    if (!view) return;
    const before = snapshotSheet(sheet);
    setOperationBusy(true);
    setOperationError(null);
    try {
      const conditions = [...(view.conditions ?? []).filter((item) => item.column !== filter.column), filter];
      const updated = await setFilter(wb.id, sheet.id, { range: view.range, conditions });
      setWorkbook(updated);
      recordOperation(sheet.id, before, updated);
      setFilterColumn(null);
    } catch (caught) {
      setOperationError(caught instanceof Error ? caught.message : "Failed to apply filter");
    } finally {
      setOperationBusy(false);
    }
  };

  const handleCreatePivot = async () => {
    if (operationBusy) return;
    const wb = workbookRef.current;
    if (!wb) return;
    const sheet = wb.sheets.find((item) => item.id === wb.activeSheetId);
    if (!sheet) return;
    setOperationBusy(true);
    setOperationError(null);
    try {
      const updated = await createPivot(wb.id, {
        sourceSheetId: sheet.id,
        sourceRange: normalizeSelection(selection),
      });
      sheetSelectionsRef.current[updated.activeSheetId] = singleCellSelection(1, 1);
      setWorkbook(updated);
      setSelection(singleCellSelection(1, 1));
      updateFormulaDraft(null);
      setPivotCreateOpen(false);
    } catch (caught) {
      setOperationError(caught instanceof Error ? caught.message : "Failed to create pivot table");
    } finally {
      setOperationBusy(false);
    }
  };

  const handleApplyPivot = async (next: {
    rowField: string;
    columnField: string | null;
    valueField: string;
    summarizeBy: SummarizeBy;
  }) => {
    if (operationBusy) return;
    const wb = workbookRef.current;
    if (!wb) return;
    const sheet = wb.sheets.find((item) => item.id === wb.activeSheetId);
    if (!sheet) return;
    const before = snapshotSheet(sheet);
    setOperationBusy(true);
    setOperationError(null);
    try {
      const updated = await applyPivot(wb.id, sheet.id, next);
      setWorkbook(updated);
      recordOperation(sheet.id, before, updated);
    } catch (caught) {
      setOperationError(caught instanceof Error ? caught.message : "Failed to apply pivot table");
    } finally {
      setOperationBusy(false);
    }
  };

  const handleRefreshPivot = async () => {
    if (operationBusy) return;
    const wb = workbookRef.current;
    if (!wb) return;
    const sheet = wb.sheets.find((item) => item.id === wb.activeSheetId);
    if (!sheet) return;
    const before = snapshotSheet(sheet);
    setOperationBusy(true);
    setOperationError(null);
    try {
      const updated = await refreshPivot(wb.id, sheet.id);
      setWorkbook(updated);
      recordOperation(sheet.id, before, updated);
    } catch (caught) {
      setOperationError(caught instanceof Error ? caught.message : "Failed to refresh pivot table");
    } finally {
      setOperationBusy(false);
    }
  };

  const handleValidationSaved = (updated: Workbook) => {
    setWorkbook(updated);
    const captured = validationBeforeRef.current;
    if (captured) recordOperation(captured.sheetId, captured.before, updated);
  };

  const handleSortSaved = (updated: Workbook) => {
    setWorkbook(updated);
    const captured = sortBeforeRef.current;
    if (captured) recordOperation(captured.sheetId, captured.before, updated);
  };

  /** Applies the workbook returned by an undo/redo restore and keeps the selection valid. */
  const applyRestored = (updated: Workbook, sheetId: string) => {
    setWorkbook(updated);
    const affected = updated.sheets.find((item) => item.id === sheetId) ?? updated.sheets[0];
    const { rows, columns } = gridDimensions(affected.cells);
    const stored = sheetSelectionsRef.current[sheetId] ?? singleCellSelection(1, 1);
    const next = clampSelection(stored, rows, columns);
    sheetSelectionsRef.current[sheetId] = next;
    if (sheetId === updated.activeSheetId) {
      setSelection(next);
      scheduleSelectionSave(next);
    }
    updateFormulaDraft(null);
  };

  const performUndo = async () => {
    const wb = workbookRef.current;
    if (!wb || operationBusy) return;
    const entry = popUndo(wb.id);
    if (!entry) return;
    setOperationBusy(true);
    setOperationError(null);
    try {
      const updated = await restoreSheet(wb.id, entry.sheetId, entry.before);
      pushRedo(wb.id, entry);
      applyRestored(updated, entry.sheetId);
    } catch (caught) {
      pushUndo(wb.id, entry);
      setOperationError(caught instanceof Error ? caught.message : "Failed to undo");
    } finally {
      setOperationBusy(false);
      setHistoryTick((tick) => tick + 1);
    }
  };

  const performRedo = async () => {
    const wb = workbookRef.current;
    if (!wb || operationBusy) return;
    const entry = popRedo(wb.id);
    if (!entry) return;
    setOperationBusy(true);
    setOperationError(null);
    try {
      const updated = await restoreSheet(wb.id, entry.sheetId, entry.after);
      pushUndo(wb.id, entry);
      applyRestored(updated, entry.sheetId);
    } catch (caught) {
      pushRedo(wb.id, entry);
      setOperationError(caught instanceof Error ? caught.message : "Failed to redo");
    } finally {
      setOperationBusy(false);
      setHistoryTick((tick) => tick + 1);
    }
  };

  performUndoRef.current = () => void performUndo();
  performRedoRef.current = () => void performRedo();

  return (
    <main className="editor-page">
      <header className="editor-page__header">
        <p className="editor-page__back">
          <a href={makeHash("/")}>Back to workbooks</a>
        </p>
        <div className="editor-page__title-row">
          <h1>{workbook.name}</h1>
          <span className="editor-page__updated">Last updated: {formatUpdated(workbook.updatedAt)}</span>
          <Button onClick={() => setRenameOpen(true)}>Rename workbook</Button>
        </div>
      </header>
      <div className="editor-page__toolbar" role="toolbar" aria-label="Workbook toolbar">
        <Button disabled={!canUndo(workbook.id) || operationBusy} onClick={() => void performUndo()}>
          Undo
        </Button>
        <Button disabled={!canRedo(workbook.id) || operationBusy} onClick={() => void performRedo()}>
          Redo
        </Button>
        <Menu
          triggerLabel="Data"
          menuLabel="Data"
          items={[
            { id: "create-filter", label: "Create filter", onSelect: () => void handleCreateFilter() },
            {
              id: "sort-range",
              label: "Sort range",
              onSelect: () => {
                sortBeforeRef.current = { sheetId: activeSheet.id, before: snapshotSheet(activeSheet) };
                setSortOpen(true);
              },
            },
            {
              id: "data-validation",
              label: "Data validation",
              onSelect: () => {
                validationBeforeRef.current = { sheetId: activeSheet.id, before: snapshotSheet(activeSheet) };
                setValidationOpen(true);
              },
            },
            { id: "create-pivot", label: "Create pivot table", onSelect: () => setPivotCreateOpen(true) },
            { id: "clear-filter", label: "Clear filter", disabled: !activeFilterView, onSelect: () => void handleClearFilter() },
          ]}
        />
        <Button onClick={exportCsv}>Export CSV</Button>
      </div>
      <div className="formula-bar">
        <span className="formula-bar__ref" aria-label="Active cell">
          {cellCoordinate(selection.start.row, selection.start.column)}
        </span>
        <input
          className="formula-bar__input"
          aria-label="Formula bar"
          value={formulaBarValue}
          readOnly={operationBusy}
          onFocus={() => {
            // Focus tracking is not needed; drafts are synchronized through a ref.
          }}
          onChange={(event) => updateFormulaDraft(event.target.value)}
          onBlur={() => {
            const draft = formulaDraftRef.current;
            if (draft !== null && draft !== activeContent) {
              void commitCell(selection.start.row, selection.start.column, draft);
            }
            updateFormulaDraft(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              const value = formulaDraftRef.current ?? activeContent;
              commitFormulaBar(value);
              updateFormulaDraft(null);
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              updateFormulaDraft(null);
              event.currentTarget.blur();
            }
          }}
        />
      </div>
      <WorksheetTabBar
        sheets={workbook.sheets}
        activeId={activeSheet.id}
        onChange={(sheetId) => void handleTabChange(sheetId)}
        onAdd={() => void handleAddSheet()}
        onRename={handleRenameSheet}
        onDelete={worksheetDeletion.handleDelete}
        renderPanel={(sheet) => (
          <div className="editor-page__panel">
            {sheet.pivot ? (
              <PivotEditor
                config={sheet.pivot}
                headers={pivotHeaders}
                busy={operationBusy}
                error={pivotError}
                onApply={(next) => void handleApplyPivot(next)}
                onRefresh={() => void handleRefreshPivot()}
              />
            ) : null}
            <WorksheetGrid
              cells={sheet.cells}
              selection={sheet.id === activeSheet.id ? selection : (sheetSelectionsRef.current[sheet.id] ?? initialSelectionForSheet(sheet))}
              hiddenRows={hiddenRows}
              filterHeaderCells={filterHeaderCells}
              validationRules={sheet.validationRules}
              onOpenFilter={(column) => setFilterColumn(column)}
              onSelect={handleSelect}
              onCommitCell={(row, column, value) => void commitCell(row, column, value)}
              onCopy={handleCopy}
              onCut={handleCut}
              onPasteBuffer={handlePasteBuffer}
              onPasteText={handlePasteText}
              onInsertRow={(row, position) => void handleSheetStructure(position === "above" ? "insert-row-above" : "insert-row-below", row)}
              onDeleteRow={(row) => void handleSheetStructure("delete-row", row)}
              onInsertColumn={(column, position) => void handleSheetStructure(position === "left" ? "insert-column-left" : "insert-column-right", column)}
              onDeleteColumn={(column) => void handleSheetStructure("delete-column", column)}
            />
          </div>
        )}
      />
      {operationBusy ? (
        <p role="status" className="editor-page__operation-status">
          Updating worksheet…
        </p>
      ) : operationError ? (
        <p role="alert" className="editor-page__operation-error">
          {operationError}
        </p>
      ) : null}
      <RenameWorkbookDialog
        open={renameOpen}
        workbookId={workbook.id}
        initialName={workbook.name}
        onOpenChange={setRenameOpen}
        onSaved={setWorkbook}
      />
      <RenameWorksheetDialog
        open={renameSheetTarget !== null}
        workbookId={workbook.id}
        sheet={renameSheetTarget}
        onOpenChange={(open) => {
          if (!open) setRenameSheetTarget(null);
        }}
        onSaved={setWorkbook}
      />
      <DeleteWorksheetDialog
        open={worksheetDeletion.target !== null}
        sheet={worksheetDeletion.target}
        busy={operationBusy}
        onOpenChange={(open) => {
          if (!open) worksheetDeletion.setTarget(null);
        }}
        onConfirm={() => void worksheetDeletion.handleConfirm()}
      />
      <FilterDialog
        open={filterColumn !== null}
        headerText={filterDialogHeader}
        column={filterColumn ?? 1}
        values={filterDialogValues}
        current={filterDialogCurrent}
        busy={operationBusy}
        onOpenChange={(open) => {
          if (!open) setFilterColumn(null);
        }}
        onApply={(filter) => void handleApplyFilter(filter)}
      />
      <PivotCreateDialog
        open={pivotCreateOpen}
        sourceRange={formatCellRange(normalizeSelection(selection))}
        busy={operationBusy}
        onOpenChange={setPivotCreateOpen}
        onCreate={() => void handleCreatePivot()}
      />
      <DataValidationDialog
        open={validationOpen}
        workbookId={workbook.id}
        sheetId={activeSheet.id}
        range={selectedRange}
        existing={existingValidationRule}
        onOpenChange={setValidationOpen}
        onSaved={handleValidationSaved}
      />
      <SortRangeDialog
        open={sortOpen}
        workbookId={workbook.id}
        sheetId={activeSheet.id}
        range={selectedRange}
        headers={sortHeaders}
        onOpenChange={setSortOpen}
        onSaved={handleSortSaved}
      />
    </main>
  );
}

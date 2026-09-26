import { useEffect, useRef, useState } from 'react';
import type { ClipboardEvent as ReactClipboardEvent, FormEvent, KeyboardEvent } from 'react';
import { getWorkbook, saveWorkbook } from '../api';
import { formatLastUpdated, cellToCoordinate, coordinateToCell, shiftCoord, type CoordChange } from '../gridUtils';
import { sheetToCsv } from '../csvExport';
import { nextSheetName } from '../sheetUtils';
import {
  workbookWithColDelete,
  workbookWithColInsert,
  workbookWithRowDelete,
  workbookWithRowInsert,
  validationErrorForInput,
  validationRuleForCoord,
  refreshPivot,
  parseRange,
} from '../rowColOps';
import { applyClipboardPasteToSheet, applyPasteToSheet } from '../pasteOps';
import {
  clipboardRowsForSheet,
  clipboardTextForRows,
  getInternalClipboard,
  setInternalClipboard,
  type InternalClipboard,
} from '../internalClipboard';
import { readExternalClipboardText } from '../clipboard';
import {
  activeFilterOf,
  distinctValuesInColumn,
} from '../filter';
import { sortSheetRange, type SortOrder } from '../sort';
import {
  computePivot,
  headerTextsInRange,
  nextPivotName,
  PIVOT_FIELD_MISSING,
} from '../pivot';
import type {
  CellMap,
  FilterCondition,
  FilterCriterion,
  FilterView,
  PivotConfig,
  PivotResult,
  PivotSummarizeBy,
  Sheet,
  ValidationRule,
  Workbook,
} from '../types';
import WorksheetGrid, {
  type ColMenuAction,
  type GridSelection,
  type RowMenuAction,
} from '../components/WorksheetGrid';

interface EditorPageProps {
  workbookId: string;
}

export default function EditorPage({ workbookId }: EditorPageProps) {
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selection, setSelection] = useState<GridSelection>({ anchor: 'A1', active: 'A1' });
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameSaving, setRenameSaving] = useState(false);
  const [openSheetMenu, setOpenSheetMenu] = useState<string | null>(null);
  const [rowMenuRow, setRowMenuRow] = useState<number | null>(null);
  const [colMenuCol, setColMenuCol] = useState<number | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [renameSheetId, setRenameSheetId] = useState<string | null>(null);
  const [renameSheetName, setRenameSheetName] = useState('');
  const [renameSheetError, setRenameSheetError] = useState<string | null>(null);
  const [renameSheetSaving, setRenameSheetSaving] = useState(false);
  const [deleteSheetId, setDeleteSheetId] = useState<string | null>(null);
  const [deleteSheetSaving, setDeleteSheetSaving] = useState(false);
  const [deleteSheetError, setDeleteSheetError] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [openDataMenu, setOpenDataMenu] = useState(false);
  const [validationDialogOpen, setValidationDialogOpen] = useState(false);
  const [validationRuleType, setValidationRuleType] = useState<'dropdown' | 'number'>(
    'dropdown'
  );
  const [validationAllowedValues, setValidationAllowedValues] = useState('');
  const [validationMin, setValidationMin] = useState('');
  const [validationMax, setValidationMax] = useState('');
  const [validationEditingRule, setValidationEditingRule] = useState<ValidationRule | null>(
    null
  );
  const [validationDialogError, setValidationDialogError] = useState<string | null>(null);
  const [validationSaving, setValidationSaving] = useState(false);
  const [sortDialogOpen, setSortDialogOpen] = useState(false);
  const [sortColumns, setSortColumns] = useState<Array<{ column: number; header: string }>>([]);
  const [sortByColumn, setSortByColumn] = useState(0);
  const [sortOrder, setSortOrder] = useState<SortOrder>('ascending');
  const [sortHasHeader, setSortHasHeader] = useState(true);
  const [sortDialogError, setSortDialogError] = useState<string | null>(null);
  const [sortSaving, setSortSaving] = useState(false);
  const [createPivotDialogOpen, setCreatePivotDialogOpen] = useState(false);
  const [createPivotRange, setCreatePivotRange] = useState('');
  // Draft field layout of the active pivot-result worksheet (keyed by pivot
  // id so switching worksheets resets to the persisted config or defaults).
  const [pivotEditor, setPivotEditor] = useState<{
    pivotId: string;
    rowField: string;
    columnField: string;
    valueField: string;
    summarizeBy: PivotSummarizeBy;
  } | null>(null);
  const [pivotError, setPivotError] = useState<{ pivotId: string; message: string } | null>(
    null
  );
  const createPivotDialogRef = useRef<HTMLDialogElement>(null);
  const [filterDialogColumn, setFilterDialogColumn] = useState<number | null>(null);
  const [filterDistinctValues, setFilterDistinctValues] = useState<string[]>([]);
  const [filterCheckedValues, setFilterCheckedValues] = useState<string[]>([]);
  const [filterCondition, setFilterCondition] = useState<FilterCondition>('text-contains');
  const [filterConditionValue, setFilterConditionValue] = useState('');
  const renameDialogRef = useRef<HTMLDialogElement>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const filterDialogRef = useRef<HTMLDialogElement>(null);
  const validationDialogRef = useRef<HTMLDialogElement>(null);
  const sortDialogRef = useRef<HTMLDialogElement>(null);

  // REQ-3-2-2 session history: whole-workbook snapshots of the state before
  // each undoable operation. The stacks are session-only (never persisted);
  // each undo/redo restores a snapshot and persists it so the visible state
  // survives a refresh. The history lives in this component instance, so it
  // is naturally isolated per workbook (the router mounts one EditorPage per
  // workbook id).
  const undoStackRef = useRef<Workbook[]>([]);
  const redoStackRef = useRef<Workbook[]>([]);
  // Tracks the most recent cell-edit so consecutive keystrokes of the same
  // editing session collapse into a single undo entry.
  const lastEditRef = useRef<{ coord: string; after: Workbook } | null>(null);

  const stateRef = useRef<Workbook | null>(null);
  const lastCommittedRef = useRef<Workbook | null>(null);
  const editStartRef = useRef<{ coord: string; value: string } | null>(null);
  const versionRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const draggingRef = useRef(false);
  const mouseUpBoundRef = useRef(false);
  const selectionRef = useRef<GridSelection>({ anchor: 'A1', active: 'A1' });

  // The working selection is mirrored into a ref so the window-level mouseup
  // handler (bound once) always reads the latest rectangle.
  function updateSelection(next: GridSelection) {
    selectionRef.current = next;
    setSelection(next);
  }

  function withSheetSelection(
    workbook: Workbook,
    sheetId: string,
    anchor: string,
    active: string
  ): Workbook {
    return {
      ...workbook,
      sheets: workbook.sheets.map((s) =>
        s.id === sheetId ? { ...s, selection: { anchor, active } } : s
      ),
    };
  }

  // Persists the current selection rectangle on the active worksheet. No-op
  // when it already matches the sheet's stored selection, so unrelated
  // mouse-ups and repeated keys do not write redundant saves.
  function persistSelection() {
    const current = stateRef.current;
    if (!current) {
      return;
    }
    const sheet = current.sheets.find((s) => s.id === current.activeSheetId);
    if (!sheet) {
      return;
    }
    const sel = selectionRef.current;
    if (
      sheet.selection &&
      sheet.selection.anchor === sel.anchor &&
      sheet.selection.active === sel.active
    ) {
      return;
    }
    versionRef.current += 1;
    const next = withSheetSelection(current, sheet.id, sel.anchor, sel.active);
    setWorkbook(next);
    persist(next);
  }

  // Shifts both corners of the selection rectangle to follow a row/column
  // structural change, keeping the rectangle intact and inside sheet bounds.
  function shiftSelectionForChange(
    selection: GridSelection,
    change: CoordChange,
    sheet: Sheet
  ): GridSelection {
    const clamp = (coord: string): string => {
      const c = cellToCoordinate(coord);
      if (!c) {
        return coord;
      }
      return coordinateToCell(
        Math.min(Math.max(c.row, 0), sheet.rowCount - 1),
        Math.min(Math.max(c.column, 0), sheet.columnCount - 1)
      );
    };
    const anchor = shiftCoord(selection.anchor, change) ?? selection.anchor;
    const active = shiftCoord(selection.active, change) ?? selection.active;
    return { anchor: clamp(anchor), active: clamp(active) };
  }

  function restoreSelectionFromSheet(wb: Workbook) {
    const sheet = wb.sheets.find((s) => s.id === wb.activeSheetId) ?? wb.sheets[0] ?? null;
    updateSelection(sheet?.selection ?? { anchor: 'A1', active: 'A1' });
  }

  useEffect(() => {
    let cancelled = false;
    getWorkbook(workbookId)
      .then((wb) => {
        if (cancelled) {
          return;
        }
        stateRef.current = wb;
        lastCommittedRef.current = wb;
        setWorkbook(wb);
        restoreSelectionFromSheet(wb);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setLoadError(err.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workbookId]);


  const activeSheet: Sheet | null = workbook
    ? workbook.sheets.find((s) => s.id === workbook.activeSheetId) ?? workbook.sheets[0] ?? null
    : null;

  function persist(nextWorkbook: Workbook) {
    stateRef.current = nextWorkbook;
    const myVersion = versionRef.current;
    saveQueueRef.current = saveQueueRef.current
      .then(async () => {
        const current = stateRef.current;
        if (!current) {
          return;
        }
        try {
          const saved = await saveWorkbook(current.id, current);
          if (versionRef.current === myVersion) {
            lastCommittedRef.current = saved;
            setWorkbook({ ...saved });
          }
          setSaveError(null);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Save failed';
          if (versionRef.current === myVersion) {
            const committed = lastCommittedRef.current;
            if (committed) {
              stateRef.current = committed;
              setWorkbook({ ...committed });
              // A failed operation never takes effect; when the rolled back
              // state equals the top undo entry, that entry is stale (undo
              // would restore the identical state) and is dropped.
              const top = undoStackRef.current[undoStackRef.current.length - 1];
              if (top === committed) {
                undoStackRef.current.pop();
                setCanUndo(undoStackRef.current.length > 0);
              }
              // A failed save also reverts the selection to the last
              // successful persisted rectangle for that worksheet (or the
              // default A1 when none was ever persisted).
              const committedSheet = committed.sheets.find(
                (s) => s.id === committed.activeSheetId
              );
              updateSelection(
                committedSheet?.selection ?? { anchor: 'A1', active: 'A1' }
              );
            }
          }
          setSaveError(message);
        }
      });
  }

  // Undo/redo history -------------------------------------------------------
  //
  // Undoable operations push the pre-operation workbook snapshot. A failed
  // save rolls the state back to the last successful commit; when that rolled
  // back state equals the top undo entry (the failed operation was the most
  // recent one), the stale entry is dropped so Undo stays accurate.

  function recordEditHistory(before: Workbook, coord: string) {
    const last = lastEditRef.current;
    if (last && last.coord === coord && last.after === before) {
      // The keystroke continues the same editing session: keep the single
      // entry pushed when the session started.
      return;
    }
    undoStackRef.current.push(before);
    redoStackRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }

  function recordOpHistory(before: Workbook) {
    undoStackRef.current.push(before);
    redoStackRef.current = [];
    lastEditRef.current = null;
    setCanUndo(true);
    setCanRedo(false);
  }

  function clearRedoHistory() {
    redoStackRef.current = [];
    lastEditRef.current = null;
    setCanRedo(false);
  }

  function restoreHistorySnapshot(next: Workbook) {
    versionRef.current += 1;
    stateRef.current = next;
    const sheet =
      next.sheets.find((s) => s.id === next.activeSheetId) ?? next.sheets[0] ?? null;
    updateSelection(sheet?.selection ?? { anchor: 'A1', active: 'A1' });
    setValidationError(null);
    setWorkbook(next);
    persist(next);
  }

  function handleUndo() {
    const current = stateRef.current;
    if (!current) {
      return;
    }
    const before = undoStackRef.current.pop();
    if (!before) {
      return;
    }
    redoStackRef.current.push(current);
    lastEditRef.current = null;
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(true);
    restoreHistorySnapshot(before);
  }

  function handleRedo() {
    const current = stateRef.current;
    if (!current) {
      return;
    }
    const next = redoStackRef.current.pop();
    if (!next) {
      return;
    }
    undoStackRef.current.push(current);
    lastEditRef.current = null;
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
    restoreHistorySnapshot(next);
  }

  // Ctrl+Z undoes and Ctrl+Y redoes the last operation anywhere in the
  // editor (including while a grid/formula-bar input is focused).
  useEffect(() => {
    function onWindowKeyDown(event: globalThis.KeyboardEvent) {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        handleUndo();
      } else if (key === 'y') {
        event.preventDefault();
        handleRedo();
      }
    }
    window.addEventListener('keydown', onWindowKeyDown);
    return () => window.removeEventListener('keydown', onWindowKeyDown);
  }, []);

  // Empty values are removed from the cell map so a cancelled or cleared
  // cell is restored to the exact pre-edit state (no explicit '' entry).
  function withCellValue(cells: CellMap, coord: string, value: string): CellMap {
    const next = { ...cells };
    if (value === '') {
      delete next[coord];
    } else {
      next[coord] = value;
    }
    return next;
  }

  function updateSheetCells(sheet: Sheet, coord: string, value: string) {
    const current = stateRef.current ?? workbook;
    if (!current) {
      return;
    }
    recordEditHistory(current, coord);
    versionRef.current += 1;
    const next: Workbook = {
      ...current,
      sheets: current.sheets.map((s) =>
        s.id === sheet.id
          ? { ...s, cells: withCellValue(s.cells, coord, value) }
          : s
      ),
    };
    lastEditRef.current = { coord, after: next };
    setWorkbook(next);
    persist(next);
  }

  function handleCellValueChange(coord: string, value: string) {
    if (!activeSheet || !stateRef.current) {
      return;
    }
    const error = validationErrorForInput(activeSheet, coord, value);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    updateSheetCells(activeSheet, coord, value);
  }

  // Copy or cut the current selection into the in-application clipboard. The
  // cells themselves are not changed (cut clears the source only when the
  // data is pasted), and the OS clipboard receives a best-effort text copy.
  function copyRange(kind: 'copy' | 'cut', event?: ReactClipboardEvent<HTMLDivElement>) {
    const current = stateRef.current;
    if (!current) {
      return;
    }
    const sheet =
      current.sheets.find((s) => s.id === current.activeSheetId) ??
      current.sheets[0] ??
      null;
    if (!sheet) {
      return;
    }
    const built = clipboardRowsForSheet(
      sheet,
      selectionRef.current.anchor,
      selectionRef.current.active
    );
    setInternalClipboard({
      sheetId: sheet.id,
      kind,
      anchor: built.topLeft,
      active: built.bottomRight,
      rows: built.rows,
    });
    const text = clipboardTextForRows(built.rows);
    if (event?.clipboardData) {
      try {
        event.clipboardData.setData('text/plain', text);
      } catch {
        // best effort only
      }
    } else {
      // Toolbar/context-menu copy: write to the OS clipboard if available.
      try {
        const clipboard = navigator.clipboard;
        if (clipboard && typeof clipboard.writeText === 'function') {
          clipboard.writeText(text).catch(() => undefined);
        }
      } catch {
        // best effort only
      }
    }
  }

  function handleInternalPaste(clipboard: InternalClipboard, startCoord: string) {
    const current = stateRef.current;
    if (!current) {
      return;
    }
    const sheet =
      current.sheets.find((s) => s.id === current.activeSheetId) ??
      current.sheets[0] ??
      null;
    if (!sheet) {
      return;
    }
    const outcome = applyClipboardPasteToSheet(sheet, startCoord, clipboard);
    if (outcome.error) {
      // The whole rectangle is rejected; every cell keeps its value.
      setValidationError(outcome.error);
      return;
    }
    setValidationError(null);
    recordOpHistory(current);
    versionRef.current += 1;
    const next: Workbook = {
      ...current,
      sheets: current.sheets.map((s) =>
        s.id === sheet.id ? { ...s, cells: outcome.cells } : s
      ),
    };
    setWorkbook(next);
    persist(next);
  }

  function handleExternalPasteText(text: string, startCoord: string) {
    const current = stateRef.current;
    if (!current) {
      return;
    }
    const sheet =
      current.sheets.find((s) => s.id === current.activeSheetId) ??
      current.sheets[0] ??
      null;
    if (!sheet) {
      return;
    }
    const outcome = applyPasteToSheet(sheet, startCoord, text);
    if (outcome.error) {
      // The whole rectangle is rejected; every target cell keeps its value.
      setValidationError(outcome.error);
      return;
    }
    setValidationError(null);
    recordOpHistory(current);
    versionRef.current += 1;
    const next: Workbook = {
      ...current,
      sheets: current.sheets.map((s) =>
        s.id === sheet.id ? { ...s, cells: outcome.cells } : s
      ),
    };
    setWorkbook(next);
    persist(next);
  }

  function handlePasteText(text: string, startCoord: string) {
    // A same-worksheet in-application clipboard takes precedence over the OS
    // clipboard so copied formulas can be translated by the target offset.
    const internal = getInternalClipboard();
    if (internal && internal.sheetId === stateRef.current?.activeSheetId) {
      handleInternalPaste(internal, startCoord);
      return;
    }
    handleExternalPasteText(text, startCoord);
  }

  function handleEditStart(coord: string, value: string) {
    editStartRef.current = { coord, value };
  }

  function handleRevertCell(coord: string) {
    const committed = lastCommittedRef.current;
    const sheet = activeSheet;
    if (!committed || !sheet) {
      return;
    }
    const committedSheet = committed.sheets.find((s) => s.id === sheet.id);
    const start = editStartRef.current;
    // Escape cancels the whole uncommitted editing session: restore the value
    // the cell had when the user started editing it, even if intermediate
    // keystrokes were already persisted.
    const savedValue =
      start && start.coord === coord
        ? start.value
        : committedSheet
          ? (committedSheet.cells[coord] ?? '')
          : '';
    const current = stateRef.current;
    if (!current) {
      return;
    }
    setValidationError(null);
    clearRedoHistory();
    versionRef.current += 1;
    const next: Workbook = {
      ...current,
      sheets: current.sheets.map((s) =>
        s.id === sheet.id
          ? { ...s, cells: withCellValue(s.cells, coord, savedValue) }
          : s
      ),
    };
    setWorkbook(next);
    persist(next);
  }

  function handleCellActivate(coord: string) {
    updateSelection({ anchor: coord, active: coord });
    draggingRef.current = true;
    if (!mouseUpBoundRef.current) {
      mouseUpBoundRef.current = true;
      window.addEventListener('mouseup', handleMouseUp);
    }
  }

  function handleCellDrag(coord: string) {
    if (!draggingRef.current) {
      return;
    }
    updateSelection({ anchor: selectionRef.current.anchor, active: coord });
  }

  function handleMouseUp() {
    draggingRef.current = false;
    // A click or a completed drag: persist the full selection rectangle for
    // the active worksheet.
    persistSelection();
  }

  useEffect(() => {
    return () => {
      if (mouseUpBoundRef.current) {
        window.removeEventListener('mouseup', handleMouseUp);
      }
    };
  }, []);

  function focusCell(coord: string) {
    const input = document.querySelector<HTMLInputElement>(
      `[data-coord="${coord}"] .cell-input`
    );
    input?.focus();
  }

  function moveSelection(deltaRow: number, deltaColumn: number, extend: boolean) {
    const current = stateRef.current;
    if (!current) {
      return;
    }
    const sheet = current.sheets.find((s) => s.id === current.activeSheetId);
    if (!sheet) {
      return;
    }
    const active = cellToCoordinate(selectionRef.current.active);
    if (!active) {
      return;
    }
    const row = Math.min(
      Math.max(active.row + deltaRow, 0),
      sheet.rowCount - 1
    );
    const column = Math.min(
      Math.max(active.column + deltaColumn, 0),
      sheet.columnCount - 1
    );
    const nextCoord = coordinateToCell(row, column);
    const next: GridSelection = extend
      ? { anchor: selectionRef.current.anchor, active: nextCoord }
      : { anchor: nextCoord, active: nextCoord };
    updateSelection(next);
    persistSelection();
    focusCell(nextCoord);
  }

  function handleCommitMove(deltaRow: number, deltaColumn: number) {
    moveSelection(deltaRow, deltaColumn, false);
  }

  function handleTabSelect(sheetId: string) {
    const current = stateRef.current;
    if (!current || current.activeSheetId === sheetId) {
      return;
    }
    versionRef.current += 1;
    const next: Workbook = { ...current, activeSheetId: sheetId };
    const target = next.sheets.find((s) => s.id === sheetId);
    updateSelection(target?.selection ?? { anchor: 'A1', active: 'A1' });
    setWorkbook(next);
    setValidationError(null);
    setDeleteSheetError(null);
    // The edit-start reference belongs to the source worksheet's editing
    // session; after switching it must never revert a cell of another
    // worksheet (REQ-2-1-2).
    editStartRef.current = null;
    persist(next);
  }

  function focusSheetOptions(sheetId: string) {
    const el = document.querySelector<HTMLButtonElement>(`[data-sheet-options="${sheetId}"]`);
    el?.focus();
  }

  function handleAddWorksheet() {
    const current = stateRef.current;
    if (!current) {
      return;
    }
    const baseSheet =
      current.sheets.find((s) => s.id === current.activeSheetId) ?? current.sheets[0];
    const newSheet: Sheet = {
      id: 'sheet-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      name: nextSheetName(current.sheets.map((s) => s.name)),
      rowCount: baseSheet ? baseSheet.rowCount : 20,
      columnCount: baseSheet ? baseSheet.columnCount : 6,
      cells: {},
      filterViews: [],
      validationRules: [],
    };
    versionRef.current += 1;
    const next: Workbook = {
      ...current,
      activeSheetId: newSheet.id,
      sheets: [...current.sheets, newSheet],
    };
    setWorkbook(next);
    updateSelection({ anchor: 'A1', active: 'A1' });
    setValidationError(null);
    setDeleteSheetError(null);
    persist(next);
  }

  function toggleSheetMenu(sheetId: string) {
    setOpenSheetMenu((prev) => (prev === sheetId ? null : sheetId));
  }

  function closeSheetMenu() {
    setOpenSheetMenu(null);
  }

  useEffect(() => {
    if (openSheetMenu === null) {
      return;
    }
    function onDocumentMouseDown(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (target.closest('[data-sheet-menu]') || target.closest('[data-sheet-options]')) {
        return;
      }
      setOpenSheetMenu(null);
    }
    document.addEventListener('mousedown', onDocumentMouseDown);
    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
    };
  }, [openSheetMenu]);

  function openRowMenu(row: number) {
    setOpenSheetMenu(null);
    setColMenuCol(null);
    setRowMenuRow(row);
  }

  useEffect(() => {
    if (rowMenuRow === null) {
      return;
    }
    function onDocumentMouseDown(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (target.closest('[data-row-menu]') || target.closest('[data-row-header]')) {
        return;
      }
      setRowMenuRow(null);
    }
    document.addEventListener('mousedown', onDocumentMouseDown);
    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
    };
  }, [rowMenuRow]);

  useEffect(() => {
    if (colMenuCol === null) {
      return;
    }
    function onDocumentMouseDown(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (target.closest('[data-col-menu]') || target.closest('[data-col-header]')) {
        return;
      }
      setColMenuCol(null);
    }
    document.addEventListener('mousedown', onDocumentMouseDown);
    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
    };
  }, [colMenuCol]);

  function openColMenu(col: number) {
    setOpenSheetMenu(null);
    setRowMenuRow(null);
    setColMenuCol(col);
  }

  function handleColMenuKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const items = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-col-menu-item]')
    );
    const index = items.indexOf(event.currentTarget);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        items[(index + 1) % items.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        items[(index - 1 + items.length) % items.length]?.focus();
        break;
      case 'Home':
        event.preventDefault();
        items[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        items[items.length - 1]?.focus();
        break;
      case 'Escape':
        event.preventDefault();
        setColMenuCol(null);
        break;
      default:
        break;
    }
  }

  function handleColMenuAction(action: ColMenuAction, col: number) {
    setColMenuCol(null);
    if (action === 'delete') {
      handleDeleteColumn(col);
    } else {
      handleInsertColumn(col, action);
    }
  }

  function handleInsertColumn(col: number, where: 'left' | 'right') {
    const current = stateRef.current;
    const sheet = activeSheet;
    if (!current || !sheet) {
      return;
    }
    const colIndex0 = where === 'left' ? col - 1 : col;
    recordOpHistory(current);
    versionRef.current += 1;
    const nextSel = shiftSelectionForChange(
      selectionRef.current,
      { insertColumn: colIndex0 },
      sheet
    );
    const next = withSheetSelection(
      workbookWithColInsert(current, sheet.id, colIndex0),
      sheet.id,
      nextSel.anchor,
      nextSel.active
    );
    updateSelection(nextSel);
    setValidationError(null);
    setWorkbook(next);
    persist(next);
  }

  function handleDeleteColumn(col: number) {
    const current = stateRef.current;
    const sheet = activeSheet;
    if (!current || !sheet) {
      return;
    }
    const colIndex0 = col - 1;
    recordOpHistory(current);
    versionRef.current += 1;
    const nextSel = shiftSelectionForChange(
      selectionRef.current,
      { deleteColumn: colIndex0 },
      sheet
    );
    const next = withSheetSelection(
      workbookWithColDelete(current, sheet.id, colIndex0),
      sheet.id,
      nextSel.anchor,
      nextSel.active
    );
    updateSelection(nextSel);
    setValidationError(null);
    setWorkbook(next);
    persist(next);
  }

  function handleRowMenuKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const items = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-row-menu-item]')
    );
    const index = items.indexOf(event.currentTarget);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        items[(index + 1) % items.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        items[(index - 1 + items.length) % items.length]?.focus();
        break;
      case 'Home':
        event.preventDefault();
        items[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        items[items.length - 1]?.focus();
        break;
      case 'Escape':
        event.preventDefault();
        setRowMenuRow(null);
        break;
      default:
        break;
    }
  }

  function handleRowMenuAction(action: RowMenuAction, row: number) {
    setRowMenuRow(null);
    if (action === 'delete') {
      handleDeleteRow(row);
    } else {
      handleInsertRow(row, action);
    }
  }

  function handleInsertRow(row: number, where: 'above' | 'below') {
    const current = stateRef.current;
    const sheet = activeSheet;
    if (!current || !sheet) {
      return;
    }
    const rowIndex0 = where === 'above' ? row - 1 : row;
    recordOpHistory(current);
    versionRef.current += 1;
    const nextSel = shiftSelectionForChange(
      selectionRef.current,
      { insertRow: rowIndex0 },
      sheet
    );
    const next = withSheetSelection(
      workbookWithRowInsert(current, sheet.id, rowIndex0),
      sheet.id,
      nextSel.anchor,
      nextSel.active
    );
    updateSelection(nextSel);
    setValidationError(null);
    setWorkbook(next);
    persist(next);
  }

  function handleDeleteRow(row: number) {
    const current = stateRef.current;
    const sheet = activeSheet;
    if (!current || !sheet) {
      return;
    }
    const rowIndex0 = row - 1;
    recordOpHistory(current);
    versionRef.current += 1;
    const nextSel = shiftSelectionForChange(
      selectionRef.current,
      { deleteRow: rowIndex0 },
      sheet
    );
    const next = withSheetSelection(
      workbookWithRowDelete(current, sheet.id, rowIndex0),
      sheet.id,
      nextSel.anchor,
      nextSel.active
    );
    updateSelection(nextSel);
    setValidationError(null);
    setWorkbook(next);
    persist(next);
  }

  // REQ-5-3-1 pivot refresh. A pivot with a config recomputes its summary
  // from the current source range (the adjusted range when row/column
  // changes moved it); a missing field preserves the last successful result
  // and shows the field-error message. Legacy range-only pivots (REQ-2-2-x)
  // keep the simple adjusted-range adoption.
  function handleRefreshPivot(pivotId: string) {
    const current = stateRef.current;
    if (!current) {
      return;
    }
    const pivot = current.pivots.find((p) => p.id === pivotId);
    if (!pivot) {
      return;
    }
    if (!pivot.config) {
      versionRef.current += 1;
      const next: Workbook = {
        ...current,
        pivots: current.pivots.map((p) => (p.id === pivotId ? refreshPivot(p) : p)),
      };
      setWorkbook(next);
      persist(next);
      return;
    }
    const sourceSheet = current.sheets.find((s) => s.id === pivot.sheetId);
    if (!sourceSheet) {
      return;
    }
    const range = pivot.adjustedRange ?? pivot.sourceRange ?? '';
    const outcome = computePivot(sourceSheet, range, pivot.config);
    versionRef.current += 1;
    if (!outcome.ok) {
      // Preserve the last successful result and the source worksheet; a
      // missing selected field is recorded so the error also survives a
      // reload and opening the editor.
      const next: Workbook = {
        ...current,
        pivots: current.pivots.map((p) =>
          p.id === pivotId
            ? outcome.error === PIVOT_FIELD_MISSING
              ? {
                  id: p.id,
                  name: p.name,
                  sheetId: p.sheetId,
                  resultSheetId: p.resultSheetId,
                  sourceRange: range,
                  config: p.config,
                  fieldError: true,
                }
              : {
                  id: p.id,
                  name: p.name,
                  sheetId: p.sheetId,
                  resultSheetId: p.resultSheetId,
                  sourceRange: range,
                  config: p.config,
                }
            : p
        ),
      };
      setPivotError({ pivotId, message: outcome.error });
      setWorkbook(next);
      persist(next);
      return;
    }
    const next: Workbook = {
      ...current,
      sheets: current.sheets.map((s) =>
        s.id === pivot.resultSheetId
          ? {
              ...s,
              cells: outcome.cells,
              rowCount: Math.max(s.rowCount, outcome.maxRow + 1),
              columnCount: Math.max(s.columnCount, outcome.maxCol + 1),
            }
          : s
      ),
      pivots: current.pivots.map((p) =>
        p.id === pivotId
          ? {
              id: p.id,
              name: p.name,
              sheetId: p.sheetId,
              resultSheetId: p.resultSheetId,
              sourceRange: range,
              config: p.config,
            }
          : p
      ),
    };
    setPivotError(null);
    setWorkbook(next);
    persist(next);
  }

  function handleSheetMenuKeyDown(event: KeyboardEvent<HTMLDivElement>, sheetId: string) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpenSheetMenu(null);
      focusSheetOptions(sheetId);
    }
  }

  function handleSheetMenuItemKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    sheetId: string
  ) {
    const items = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-sheet-menu-item]')
    );
    const index = items.indexOf(event.currentTarget);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        items[(index + 1) % items.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        items[(index - 1 + items.length) % items.length]?.focus();
        break;
      case 'Home':
        event.preventDefault();
        items[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        items[items.length - 1]?.focus();
        break;
      case 'Escape':
        event.preventDefault();
        setOpenSheetMenu(null);
        focusSheetOptions(sheetId);
        break;
      default:
        break;
    }
  }

  function openRenameDialog(sheet: Sheet) {
    setOpenSheetMenu(null);
    const savedName =
      lastCommittedRef.current?.sheets.find((s) => s.id === sheet.id)?.name ?? sheet.name;
    setRenameSheetId(sheet.id);
    setRenameSheetName(savedName);
    setRenameSheetError(null);
    setRenameSheetSaving(false);
  }

  // REQ-2-1-4 Delete a Worksheet ------------------------------------------
  //
  // "Delete" in the worksheet tab menu opens a dialog named "Delete worksheet"
  // (visible text includes the target worksheet name) with a "Delete
  // worksheet" confirmation button. Confirming removes the worksheet and
  // everything it owns (cells, formulas, filters, validation, pivot results);
  // pivot records whose result worksheet is deleted are removed so the source
  // worksheet is no longer constrained by that pivot table. A worksheet that
  // is still the source of a pivot table cannot be deleted. When only one
  // worksheet remains, Delete shows an error instead of opening the dialog.
  // The optimistic removal goes through the serialized save queue; a failed
  // save rolls back so the target tab and grid remain visible and unchanged.

  function openDeleteDialog(sheet: Sheet) {
    setOpenSheetMenu(null);
    const current = stateRef.current;
    if (!current) {
      return;
    }
    if (current.sheets.length <= 1) {
      setDeleteSheetError('A workbook must contain at least one worksheet');
      return;
    }
    setDeleteSheetId(sheet.id);
    setDeleteSheetSaving(false);
    setDeleteSheetError(null);
  }

  useEffect(() => {
    if (deleteSheetId === null) {
      return;
    }
    const el = deleteDialogRef.current;
    if (!el) {
      return;
    }
    if (typeof el.showModal === 'function') {
      try {
        el.showModal();
        return;
      } catch {
        // fall back to the open attribute where showModal is unavailable
      }
    }
    el.setAttribute('open', '');
  }, [deleteSheetId]);

  function handleDeleteDialogClose() {
    const sheetId = deleteSheetId;
    setDeleteSheetId(null);
    // The rejection error ("Please delete or rebuild dependent pivot tables
    // first") is displayed after the dialog closes; it must not be cleared
    // by this handler (the close event fires asynchronously in real
    // browsers, after the confirm handler has set it). New delete attempts,
    // tab switches and worksheet additions clear it instead.
    setDeleteSheetSaving(false);
    if (sheetId) {
      // Defer so the browser's own modal-dialog focus restoration completes first.
      window.setTimeout(() => focusSheetOptions(sheetId), 0);
    }
  }

  function closeDeleteDialog() {
    const el = deleteDialogRef.current;
    if (el && typeof el.close === 'function') {
      // in real browsers this fires the close event, which runs the cleanup
      el.close();
    } else {
      handleDeleteDialogClose();
    }
  }

  function confirmDeleteSheet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = stateRef.current;
    if (!current || deleteSheetId === null || deleteSheetSaving) {
      return;
    }
    const target = current.sheets.find((s) => s.id === deleteSheetId);
    if (!target) {
      closeDeleteDialog();
      return;
    }
    if (current.sheets.length <= 1) {
      closeDeleteDialog();
      setDeleteSheetError('A workbook must contain at least one worksheet');
      return;
    }
    // A worksheet that is still the source of a pivot table cannot be
    // deleted; the confirmation is rejected, the dialog closes and both the
    // source data and the pivot results stay unchanged.
    if (current.pivots.some((p) => p.sheetId === deleteSheetId)) {
      closeDeleteDialog();
      setDeleteSheetError('Please delete or rebuild dependent pivot tables first');
      return;
    }
    setDeleteSheetSaving(true);
    setDeleteSheetError(null);
    versionRef.current += 1;
    const index = current.sheets.findIndex((s) => s.id === deleteSheetId);
    const remaining = current.sheets.filter((s) => s.id !== deleteSheetId);
    let activeSheetId = current.activeSheetId;
    if (activeSheetId === deleteSheetId) {
      // The adjacent worksheet becomes active: the sheet that followed the
      // deleted tab, or the previous one when the last tab was deleted.
      const adjacent = remaining[Math.min(index, remaining.length - 1)];
      activeSheetId = adjacent ? adjacent.id : (remaining[0]?.id ?? '');
    }
    const next: Workbook = {
      ...current,
      activeSheetId,
      sheets: remaining,
      // Deleting a pivot-result worksheet removes its pivot record, so the
      // source worksheet is no longer constrained by that pivot table.
      pivots: current.pivots.filter((p) => p.resultSheetId !== deleteSheetId),
    };
    const active = next.sheets.find((s) => s.id === activeSheetId);
    updateSelection(active?.selection ?? { anchor: 'A1', active: 'A1' });
    setWorkbook(next);
    setValidationError(null);
    // The edit-start reference belongs to the deleted worksheet's editing
    // session; it must never revert a cell of the newly active worksheet.
    editStartRef.current = null;
    closeDeleteDialog();
    persist(next);
  }

  useEffect(() => {
    if (renameSheetId === null) {
      return;
    }
    const el = renameDialogRef.current;
    if (!el) {
      return;
    }
    if (typeof el.showModal === 'function') {
      try {
        el.showModal();
        return;
      } catch {
        // fall back to the open attribute where showModal is unavailable
      }
    }
    el.setAttribute('open', '');
  }, [renameSheetId]);

  function handleRenameDialogClose() {
    const sheetId = renameSheetId;
    setRenameSheetId(null);
    setRenameSheetError(null);
    setRenameSheetSaving(false);
    if (sheetId) {
      // Defer so the browser's own modal-dialog focus restoration completes first.
      window.setTimeout(() => focusSheetOptions(sheetId), 0);
    }
  }

  function closeRenameDialog() {
    const el = renameDialogRef.current;
    if (el && typeof el.close === 'function') {
      // in real browsers this fires the close event, which runs the cleanup
      el.close();
    } else {
      handleRenameDialogClose();
    }
  }

  function submitSheetRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = stateRef.current;
    if (!current || renameSheetId === null || renameSheetSaving) {
      return;
    }
    const sheet = current.sheets.find((s) => s.id === renameSheetId);
    if (!sheet) {
      return;
    }
    const trimmed = renameSheetName.trim();
    if (!trimmed) {
      setRenameSheetError('Worksheet name cannot be empty');
      return;
    }
    if (current.sheets.some((s) => s.id !== sheet.id && s.name.trim() === trimmed)) {
      setRenameSheetError('Worksheet name already exists');
      return;
    }
    if (trimmed === sheet.name) {
      closeRenameDialog();
      return;
    }
    setRenameSheetSaving(true);
    setRenameSheetError(null);
    versionRef.current += 1;
    const myVersion = versionRef.current;
    const next: Workbook = {
      ...current,
      sheets: current.sheets.map((s) => (s.id === sheet.id ? { ...s, name: trimmed } : s)),
    };
    stateRef.current = next;
    setWorkbook(next);
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      const latest = stateRef.current;
      if (!latest) {
        return;
      }
      try {
        const saved = await saveWorkbook(latest.id, latest);
        if (versionRef.current === myVersion) {
          lastCommittedRef.current = saved;
          stateRef.current = saved;
          setWorkbook({ ...saved });
        }
        setRenameSheetSaving(false);
        setRenameSheetError(null);
        closeRenameDialog();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Rename failed';
        if (versionRef.current === myVersion) {
          const committed = lastCommittedRef.current;
          if (committed) {
            stateRef.current = committed;
            setWorkbook({ ...committed });
            const committedSheet = committed.sheets.find((s) => s.id === sheet.id);
            setRenameSheetName(committedSheet ? committedSheet.name : sheet.name);
          }
        }
        setRenameSheetSaving(false);
        setRenameSheetError(message);
      }
    });
  }

  function handleFormulaBarChange(value: string) {
    if (!activeSheet || !stateRef.current) {
      return;
    }
    const error = validationErrorForInput(activeSheet, selection.active, value);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    updateSheetCells(activeSheet, selection.active, value);
  }

  async function handleMenuPaste(coord: string) {
    const internal = getInternalClipboard();
    if (internal && internal.sheetId === stateRef.current?.activeSheetId) {
      handleInternalPaste(internal, coord);
      return;
    }
    let text: string;
    try {
      text = await readExternalClipboardText();
    } catch {
      setValidationError('Unable to read the clipboard. Please press Ctrl+V to paste.');
      return;
    }
    handleExternalPasteText(text, coord);
  }

  function handleToolbarPaste() {
    const start = selectionRef.current.anchor;
    const internal = getInternalClipboard();
    if (internal && internal.sheetId === stateRef.current?.activeSheetId) {
      handleInternalPaste(internal, start);
      return;
    }
    readExternalClipboardText()
      .then((text) => handleExternalPasteText(text, start))
      .catch(() =>
        setValidationError('Unable to read the clipboard. Please press Ctrl+V to paste.')
      );
  }

  function toggleRename() {
    if (renaming) {
      setRenaming(false);
      setRenameError(null);
      return;
    }
    const savedName = lastCommittedRef.current?.name ?? workbook?.name ?? '';
    setRenameName(savedName);
    setRenameError(null);
    setRenaming(true);
  }

  function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = stateRef.current;
    if (!current || renameSaving) {
      return;
    }
    const trimmed = renameName.trim();
    if (!trimmed) {
      setRenameError('Workbook name cannot be empty');
      return;
    }
    if (trimmed === current.name) {
      setRenaming(false);
      setRenameError(null);
      return;
    }
    setRenameSaving(true);
    setRenameError(null);
    versionRef.current += 1;
    const myVersion = versionRef.current;
    const next: Workbook = { ...current, name: trimmed };
    stateRef.current = next;
    setWorkbook(next);
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      const latest = stateRef.current;
      if (!latest) {
        return;
      }
      try {
        const saved = await saveWorkbook(latest.id, latest);
        if (versionRef.current === myVersion) {
          lastCommittedRef.current = saved;
          stateRef.current = saved;
          setWorkbook({ ...saved });
        }
        setRenameSaving(false);
        setRenaming(false);
        setRenameError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Rename failed';
        if (versionRef.current === myVersion) {
          const committed = lastCommittedRef.current;
          if (committed) {
            stateRef.current = committed;
            setWorkbook({ ...committed });
            setRenameName(committed.name);
          }
        }
        setRenameSaving(false);
        setRenameError(message);
      }
    });
  }

  function handleExportCsv() {
    if (!activeSheet) {
      return;
    }
    const csv = sheetToCsv(activeSheet);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${activeSheet.name}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  // REQ-5-1-2 filtering ------------------------------------------------
  //
  // "Data" opens a menu whose commands (menuitem role) create and clear the
  // active filter. A filter view owns a data region with headers; the header
  // row exposes "Filter <header text>" buttons that open the value/condition
  // dialog with the same name. Criteria on different columns combine with
  // AND; nonmatching rows are hidden only (never deleted/reordered) and CSV
  // export / pivot summarization still read them.

  function selectionRangeString(anchor: string, active: string): string | null {
    const a = cellToCoordinate(anchor);
    const b = cellToCoordinate(active);
    if (!a || !b) {
      return null;
    }
    return `${coordinateToCell(
      Math.min(a.row, b.row),
      Math.min(a.column, b.column)
    )}:${coordinateToCell(Math.max(a.row, b.row), Math.max(a.column, b.column))}`;
  }

  function toggleDataMenu() {
    setOpenDataMenu((prev) => !prev);
  }

  useEffect(() => {
    if (!openDataMenu) {
      return;
    }
    function onDocumentMouseDown(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (target.closest('[data-data-menu]') || target.closest('[data-data-trigger]')) {
        return;
      }
      setOpenDataMenu(false);
    }
    document.addEventListener('mousedown', onDocumentMouseDown);
    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
    };
  }, [openDataMenu]);

  function handleDataMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpenDataMenu(false);
    }
  }

  function handleDataMenuItemKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const items = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-data-menu-item]')
    );
    const index = items.indexOf(event.currentTarget);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        items[(index + 1) % items.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        items[(index - 1 + items.length) % items.length]?.focus();
        break;
      case 'Home':
        event.preventDefault();
        items[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        items[items.length - 1]?.focus();
        break;
      case 'Escape':
        event.preventDefault();
        setOpenDataMenu(false);
        break;
      default:
        break;
    }
  }

  function handleCreateFilter() {
    const current = stateRef.current;
    if (!current) {
      return;
    }
    const sheet =
      current.sheets.find((s) => s.id === current.activeSheetId) ?? current.sheets[0];
    if (!sheet) {
      return;
    }
    const range = selectionRangeString(
      selectionRef.current.anchor,
      selectionRef.current.active
    );
    if (!range) {
      return;
    }
    const view: FilterView = {
      id: 'fv-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      name: `Filter view ${sheet.filterViews.length + 1}`,
      range,
      criteria: [],
    };
    versionRef.current += 1;
    const next: Workbook = {
      ...current,
      sheets: current.sheets.map((s) =>
        s.id === sheet.id ? { ...s, filterViews: [...s.filterViews, view] } : s
      ),
    };
    setOpenDataMenu(false);
    setWorkbook(next);
    persist(next);
  }

  function handleClearFilter() {
    const current = stateRef.current;
    if (!current) {
      return;
    }
    const sheet =
      current.sheets.find((s) => s.id === current.activeSheetId) ?? current.sheets[0];
    if (!sheet || sheet.filterViews.length === 0) {
      setOpenDataMenu(false);
      return;
    }
    versionRef.current += 1;
    const next: Workbook = {
      ...current,
      sheets: current.sheets.map((s) =>
        s.id === sheet.id ? { ...s, filterViews: s.filterViews.slice(0, -1) } : s
      ),
    };
    setOpenDataMenu(false);
    setWorkbook(next);
    persist(next);
  }

  // REQ-5-3-1 pivot creation and configuration ---------------------------
  //
  // "Create pivot table" in the Data menu opens a dialog named "Create
  // pivot table" that shows "Source range: <cell range>", a "New worksheet"
  // radio option and a "Create" button. Creating appends a blank pivot-result
  // worksheet (first unused PivotN name, so Pivot1 first), records the pivot
  // on the source worksheet, activates the new worksheet and persists.

  function openCreatePivotDialog() {
    setOpenDataMenu(false);
    const current = stateRef.current;
    if (!current) {
      return;
    }
    const range = selectionRangeString(
      selectionRef.current.anchor,
      selectionRef.current.active
    );
    if (!range) {
      return;
    }
    setCreatePivotRange(range);
    setCreatePivotDialogOpen(true);
  }

  useEffect(() => {
    if (!createPivotDialogOpen) {
      return;
    }
    const el = createPivotDialogRef.current;
    if (!el) {
      return;
    }
    if (typeof el.showModal === 'function') {
      try {
        el.showModal();
        return;
      } catch {
        // fall back to the open attribute where showModal is unavailable
      }
    }
    el.setAttribute('open', '');
  }, [createPivotDialogOpen]);

  function handleCreatePivotDialogClose() {
    setCreatePivotDialogOpen(false);
    setCreatePivotRange('');
    // Defer so the browser's own modal-dialog focus restoration completes first.
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('[data-data-trigger]')?.focus();
    }, 0);
  }

  function closeCreatePivotDialog() {
    const el = createPivotDialogRef.current;
    if (el && typeof el.close === 'function') {
      // in real browsers this fires the close event, which runs the cleanup
      el.close();
    } else {
      handleCreatePivotDialogClose();
    }
  }

  function submitCreatePivot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = stateRef.current;
    if (!current) {
      return;
    }
    const sheet =
      current.sheets.find((s) => s.id === current.activeSheetId) ?? current.sheets[0];
    if (!sheet) {
      return;
    }
    const pivotSheet: Sheet = {
      id: 'sheet-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      name: nextPivotName(current.sheets.map((s) => s.name)),
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      cells: {},
      filterViews: [],
      validationRules: [],
    };
    const pivot: PivotResult = {
      id: 'pivot-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      name: pivotSheet.name,
      sheetId: sheet.id,
      resultSheetId: pivotSheet.id,
      sourceRange: createPivotRange,
    };
    versionRef.current += 1;
    const next: Workbook = {
      ...current,
      activeSheetId: pivotSheet.id,
      sheets: [...current.sheets, pivotSheet],
      pivots: [...current.pivots, pivot],
    };
    closeCreatePivotDialog();
    setWorkbook(next);
    updateSelection({ anchor: 'A1', active: 'A1' });
    setValidationError(null);
    persist(next);
  }

  // Applies the current editor configuration to the active pivot-result
  // worksheet. A failed apply (missing field, numeric value field) keeps the
  // last successful result and never modifies the source worksheet.
  function applyPivotConfig() {
    const current = stateRef.current;
    if (!current || !activePivot) {
      return;
    }
    const sourceSheet = current.sheets.find((s) => s.id === activePivot.sheetId);
    if (!sourceSheet) {
      return;
    }
    const range = activePivot.adjustedRange ?? activePivot.sourceRange ?? '';
    if (pivotRowField.trim() === '' || pivotValueField.trim() === '') {
      setPivotError({
        pivotId: activePivot.id,
        message: 'Select a row field and a value field',
      });
      return;
    }
    const config: PivotConfig = {
      rowField: pivotRowField,
      columnField: pivotColumnField || undefined,
      valueField: pivotValueField,
      summarizeBy: pivotSummarizeBy,
    };
    const outcome = computePivot(sourceSheet, range, config);
    if (!outcome.ok) {
      setPivotError({ pivotId: activePivot.id, message: outcome.error });
      return;
    }
    versionRef.current += 1;
    const next: Workbook = {
      ...current,
      sheets: current.sheets.map((s) =>
        s.id === activePivot.resultSheetId
          ? {
              ...s,
              cells: outcome.cells,
              rowCount: Math.max(s.rowCount, outcome.maxRow + 1),
              columnCount: Math.max(s.columnCount, outcome.maxCol + 1),
            }
          : s
      ),
      pivots: current.pivots.map((p) =>
        p.id === activePivot.id
          ? {
              id: p.id,
              name: p.name,
              sheetId: p.sheetId,
              resultSheetId: p.resultSheetId,
              sourceRange: range,
              config,
            }
          : p
      ),
    };
    setPivotError(null);
    setWorkbook(next);
    persist(next);
  }

  // Updates the draft field layout of the active pivot editor (kept per
  // pivot id so switching worksheets does not leak drafts between pivots).
  function updatePivotEditor(patch: Partial<{
    rowField: string;
    columnField: string;
    valueField: string;
    summarizeBy: PivotSummarizeBy;
  }>) {
    if (!activePivot) {
      return;
    }
    setPivotEditor({
      pivotId: activePivot.id,
      rowField: pivotRowField,
      columnField: pivotColumnField,
      valueField: pivotValueField,
      summarizeBy: pivotSummarizeBy,
      ...patch,
    });
  }

  function openFilterDialog(column: number) {
    const current = stateRef.current;
    if (!current) {
      return;
    }
    const sheet =
      current.sheets.find((s) => s.id === current.activeSheetId) ?? current.sheets[0];
    if (!sheet) {
      return;
    }
    const filter = activeFilterOf(sheet);
    if (!filter || !filter.range) {
      return;
    }
    const distinct = distinctValuesInColumn(sheet, filter.range, column);
    const criterion = (filter.criteria ?? []).find((c) => c.column === column);
    setFilterDistinctValues(distinct);
    setFilterCheckedValues(criterion?.selectedValues ?? distinct);
    setFilterCondition(criterion?.condition ?? 'text-contains');
    setFilterConditionValue(criterion?.value ?? '');
    setFilterDialogColumn(column);
  }

  useEffect(() => {
    if (filterDialogColumn === null) {
      return;
    }
    const el = filterDialogRef.current;
    if (!el) {
      return;
    }
    if (typeof el.showModal === 'function') {
      try {
        el.showModal();
        return;
      } catch {
        // fall back to the open attribute where showModal is unavailable
      }
    }
    el.setAttribute('open', '');
  }, [filterDialogColumn]);

  function handleFilterDialogClose() {
    const column = filterDialogColumn;
    setFilterDialogColumn(null);
    setFilterConditionValue('');
    if (column !== null) {
      // Defer so the browser's own modal-dialog focus restoration completes first.
      window.setTimeout(() => {
        document
          .querySelector<HTMLButtonElement>(`[data-header-filter="${column}"]`)
          ?.focus();
      }, 0);
    }
  }

  function applyFilterCriterion(criterion: FilterCriterion) {
    const current = stateRef.current;
    if (!current) {
      return;
    }
    const sheet =
      current.sheets.find((s) => s.id === current.activeSheetId) ?? current.sheets[0];
    if (!sheet) {
      return;
    }
    versionRef.current += 1;
    const next: Workbook = {
      ...current,
      sheets: current.sheets.map((s) => {
        if (s.id !== sheet.id) {
          return s;
        }
        return {
          ...s,
          filterViews: s.filterViews.map((view, index, arr) => {
            if (index !== arr.length - 1) {
              return view; // only the active filter changes
            }
            const criteria = [...(view.criteria ?? [])];
            const found = criteria.findIndex((c) => c.column === criterion.column);
            if (found >= 0) {
              criteria[found] = criterion;
            } else {
              criteria.push(criterion);
            }
            return { ...view, criteria };
          }),
        };
      }),
    };
    setWorkbook(next);
    persist(next);
  }

  function handleApplyValueFilter() {
    if (filterDialogColumn === null) {
      return;
    }
    applyFilterCriterion({
      column: filterDialogColumn,
      selectedValues: [...filterCheckedValues],
    });
    handleFilterDialogClose();
  }

  function handleApplyConditionFilter() {
    if (filterDialogColumn === null) {
      return;
    }
    applyFilterCriterion({
      column: filterDialogColumn,
      condition: filterCondition,
      value: filterConditionValue,
    });
    handleFilterDialogClose();
  }

  // REQ-5-1-1 sorting ----------------------------------------------------
  //
  // "Sort range" in the Data menu opens a dialog named "Sort range" with a
  // "Sort by" combo (options use the header text of the selected range),
  // an "Order" combo (Ascending/Descending), a "Data has header row"
  // checkbox and a "Sort" button. Sorting physically reorders the records
  // inside the current selection rectangle only; the order is persisted so
  // it survives refresh. A failed sort (invalid input or failed save)
  // shows an error and keeps the grid in its original order.

  function openSortDialog() {
    setOpenDataMenu(false);
    const current = stateRef.current;
    if (!current) {
      return;
    }
    const sheet =
      current.sheets.find((s) => s.id === current.activeSheetId) ?? current.sheets[0];
    if (!sheet) {
      return;
    }
    const range = selectionRangeString(
      selectionRef.current.anchor,
      selectionRef.current.active
    );
    if (!range) {
      return;
    }
    const r = parseRange(range);
    if (!r) {
      return;
    }
    const columns: Array<{ column: number; header: string }> = [];
    for (let col = r.startCol; col <= r.endCol; col += 1) {
      columns.push({
        column: col,
        header: sheet.cells[coordinateToCell(r.startRow, col)] ?? '',
      });
    }
    setSortColumns(columns);
    setSortByColumn(r.startCol);
    setSortOrder('ascending');
    setSortHasHeader(true);
    setSortDialogError(null);
    setSortSaving(false);
    setSortDialogOpen(true);
  }

  useEffect(() => {
    if (!sortDialogOpen) {
      return;
    }
    const el = sortDialogRef.current;
    if (!el) {
      return;
    }
    if (typeof el.showModal === 'function') {
      try {
        el.showModal();
        return;
      } catch {
        // fall back to the open attribute where showModal is unavailable
      }
    }
    el.setAttribute('open', '');
  }, [sortDialogOpen]);

  function handleSortDialogClose() {
    setSortDialogOpen(false);
    setSortDialogError(null);
    setSortSaving(false);
    // Defer so the browser's own modal-dialog focus restoration completes first.
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('[data-data-trigger]')?.focus();
    }, 0);
  }

  function closeSortDialog() {
    const el = sortDialogRef.current;
    if (el && typeof el.close === 'function') {
      // in real browsers this fires the close event, which runs the cleanup
      el.close();
    } else {
      handleSortDialogClose();
    }
  }

  // Persists a sort through the serialized save queue. On success the
  // dialog closes; on failure the workbook rolls back to the last successful
  // commit (the grid retains its original order) and the error is shown.
  function saveSortChange(next: Workbook, onSuccess: () => void) {
    stateRef.current = next;
    setWorkbook(next);
    const myVersion = versionRef.current;
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      const latest = stateRef.current;
      if (!latest) {
        return;
      }
      try {
        const saved = await saveWorkbook(latest.id, latest);
        if (versionRef.current === myVersion) {
          lastCommittedRef.current = saved;
          stateRef.current = saved;
          setWorkbook({ ...saved });
        }
        setSortSaving(false);
        setSortDialogError(null);
        onSuccess();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Save failed';
        if (versionRef.current === myVersion) {
          const committed = lastCommittedRef.current;
          if (committed) {
            stateRef.current = committed;
            setWorkbook({ ...committed });
            const top = undoStackRef.current[undoStackRef.current.length - 1];
            if (top === committed) {
              undoStackRef.current.pop();
              setCanUndo(undoStackRef.current.length > 0);
            }
          }
        }
        setSortSaving(false);
        setSortDialogError(message);
      }
    });
  }

  function submitSort(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = stateRef.current;
    if (!current || sortSaving) {
      return;
    }
    const sheet =
      current.sheets.find((s) => s.id === current.activeSheetId) ?? current.sheets[0];
    if (!sheet) {
      return;
    }
    const range = selectionRangeString(
      selectionRef.current.anchor,
      selectionRef.current.active
    );
    if (!range) {
      setSortDialogError('Select a range to sort');
      return;
    }
    const outcome = sortSheetRange(sheet, range, {
      column: sortByColumn,
      order: sortOrder,
      hasHeader: sortHasHeader,
    });
    if ('error' in outcome) {
      // The grid retains its original order and the error is displayed.
      setSortDialogError(outcome.error);
      return;
    }
    setSortSaving(true);
    setSortDialogError(null);
    recordOpHistory(current);
    versionRef.current += 1;
    const next: Workbook = {
      ...current,
      sheets: current.sheets.map((s) =>
        s.id === sheet.id ? outcome.sheet : s
      ),
    };
    saveSortChange(next, () => closeSortDialog());
  }

  // REQ-5-2-1 data validation ---------------------------------------------
  //
  // "Data validation" in the Data menu opens a dialog named "Data validation"
  // that configures a dropdown or inclusive number-range rule for the current
  // selection rectangle. Reopening an existing rule (its range contains the
  // selection anchor) prefills the dialog and shows a "Delete rule" button;
  // saving replaces the rule with the current range, deleting removes it, and
  // either successful operation closes the dialog without touching cell
  // values. The rule is persisted through the serialized save queue, so a
  // failed save keeps the dialog open and rolls back to the last successful
  // state.

  function openValidationDialog() {
    setOpenDataMenu(false);
    const current = stateRef.current;
    if (!current) {
      return;
    }
    const sheet =
      current.sheets.find((s) => s.id === current.activeSheetId) ?? current.sheets[0];
    if (!sheet) {
      return;
    }
    const rule = validationRuleForCoord(sheet, selectionRef.current.anchor);
    setValidationEditingRule(rule);
    if (rule && rule.type === 'dropdown') {
      setValidationRuleType('dropdown');
      setValidationAllowedValues((rule.values ?? []).join(', '));
      setValidationMin('');
      setValidationMax('');
    } else if (rule && rule.type === 'number') {
      setValidationRuleType('number');
      setValidationAllowedValues('');
      setValidationMin(typeof rule.min === 'number' ? String(rule.min) : '');
      setValidationMax(typeof rule.max === 'number' ? String(rule.max) : '');
    } else {
      setValidationRuleType('dropdown');
      setValidationAllowedValues('');
      setValidationMin('');
      setValidationMax('');
    }
    setValidationDialogError(null);
    setValidationSaving(false);
    setValidationDialogOpen(true);
  }

  useEffect(() => {
    if (!validationDialogOpen) {
      return;
    }
    const el = validationDialogRef.current;
    if (!el) {
      return;
    }
    if (typeof el.showModal === 'function') {
      try {
        el.showModal();
        return;
      } catch {
        // fall back to the open attribute where showModal is unavailable
      }
    }
    el.setAttribute('open', '');
  }, [validationDialogOpen]);

  function handleValidationDialogClose() {
    setValidationDialogOpen(false);
    setValidationDialogError(null);
    setValidationSaving(false);
    // Defer so the browser's own modal-dialog focus restoration completes first.
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('[data-data-trigger]')?.focus();
    }, 0);
  }

  function closeValidationDialog() {
    const el = validationDialogRef.current;
    if (el && typeof el.close === 'function') {
      // in real browsers this fires the close event, which runs the cleanup
      el.close();
    } else {
      handleValidationDialogClose();
    }
  }

  // Persists a validation-rule change through the serialized save queue. On
  // success the dialog closes; on failure the workbook rolls back to the last
  // successful commit, the dialog stays open and the error is displayed.
  function saveValidationChange(next: Workbook, onSuccess: () => void) {
    stateRef.current = next;
    setWorkbook(next);
    const myVersion = versionRef.current;
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      const latest = stateRef.current;
      if (!latest) {
        return;
      }
      try {
        const saved = await saveWorkbook(latest.id, latest);
        if (versionRef.current === myVersion) {
          lastCommittedRef.current = saved;
          stateRef.current = saved;
          setWorkbook({ ...saved });
        }
        setValidationSaving(false);
        setValidationDialogError(null);
        onSuccess();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Save failed';
        if (versionRef.current === myVersion) {
          const committed = lastCommittedRef.current;
          if (committed) {
            stateRef.current = committed;
            setWorkbook({ ...committed });
          }
        }
        setValidationSaving(false);
        setValidationDialogError(message);
      }
    });
  }

  function newRuleId(): string {
    return 'vr-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function submitValidationRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = stateRef.current;
    if (!current || validationSaving) {
      return;
    }
    const sheet =
      current.sheets.find((s) => s.id === current.activeSheetId) ?? current.sheets[0];
    if (!sheet) {
      return;
    }
    const range = selectionRangeString(
      selectionRef.current.anchor,
      selectionRef.current.active
    );
    if (!range) {
      return;
    }

    let rule: ValidationRule;
    if (validationRuleType === 'dropdown') {
      // Comma-separated items are trimmed of leading/trailing spaces; empty
      // items and duplicates are dropped.
      const values = validationAllowedValues
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '');
      if (values.length === 0) {
        setValidationDialogError('Please enter at least one allowed value');
        return;
      }
      const seen = new Set<string>();
      const deduped = values.filter((item) => {
        if (seen.has(item)) {
          return false;
        }
        seen.add(item);
        return true;
      });
      rule = {
        id: validationEditingRule?.id ?? newRuleId(),
        range,
        type: 'dropdown',
        values: deduped,
      };
    } else {
      if (
        validationMin.trim() === '' ||
        validationMax.trim() === '' ||
        Number.isNaN(Number(validationMin.trim())) ||
        Number.isNaN(Number(validationMax.trim()))
      ) {
        setValidationDialogError('Minimum and Maximum must be valid numbers');
        return;
      }
      const min = Number(validationMin.trim());
      const max = Number(validationMax.trim());
      rule = {
        id: validationEditingRule?.id ?? newRuleId(),
        range,
        type: 'number',
        min: Math.min(min, max),
        max: Math.max(min, max),
      };
    }

    setValidationSaving(true);
    setValidationDialogError(null);
    versionRef.current += 1;
    const next: Workbook = {
      ...current,
      sheets: current.sheets.map((s) => {
        if (s.id !== sheet.id) {
          return s;
        }
        const existingIndex = s.validationRules.findIndex((r) => r.id === rule.id);
        const rules =
          existingIndex >= 0
            ? s.validationRules.map((r) => (r.id === rule.id ? rule : r))
            : [...s.validationRules, rule];
        return { ...s, validationRules: rules };
      }),
    };
    saveValidationChange(next, () => closeValidationDialog());
  }

  function handleDeleteValidationRule() {
    const current = stateRef.current;
    if (!current || validationEditingRule === null || validationSaving) {
      return;
    }
    const sheet =
      current.sheets.find((s) => s.id === current.activeSheetId) ?? current.sheets[0];
    if (!sheet) {
      return;
    }
    setValidationSaving(true);
    setValidationDialogError(null);
    versionRef.current += 1;
    const next: Workbook = {
      ...current,
      sheets: current.sheets.map((s) =>
        s.id === sheet.id
          ? {
              ...s,
              validationRules: s.validationRules.filter(
                (r) => r.id !== validationEditingRule.id
              ),
            }
          : s
      ),
    };
    saveValidationChange(next, () => closeValidationDialog());
  }

  function retryLoad() {
    setLoadError(null);
    setWorkbook(null);
    getWorkbook(workbookId)
      .then((wb) => {
        stateRef.current = wb;
        lastCommittedRef.current = wb;
        setWorkbook(wb);
        restoreSelectionFromSheet(wb);
      })
      .catch((err: Error) => setLoadError(err.message));
  }

  if (loadError) {
    return (
      <main className="editor-page">
        <div className="error-banner" role="alert">
          {loadError}
          <button type="button" className="retry-button" onClick={retryLoad}>
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (!workbook || !activeSheet) {
    return (
      <main className="editor-page">
        <p className="loading-text" role="status">
          Loading workbook…
        </p>
      </main>
    );
  }

  const selectedCellValue = activeSheet.cells[selection.active] ?? '';
  // Pivot results belong to the worksheet they summarize; the section shows
  // only the active worksheet's results so switching tabs switches them too
  // (REQ-2-1-2).
  const activeSheetPivots = workbook.pivots.filter((p) => p.sheetId === activeSheet.id);
  // REQ-5-3-1: the active worksheet is a pivot-result worksheet when some
  // pivot writes its summary there; the "Pivot table editor" region edits
  // exactly that pivot and reads headers from its current source range.
  const activePivot =
    workbook.pivots.find((p) => p.resultSheetId === activeSheet.id) ?? null;
  const pivotSourceSheet = activePivot
    ? workbook.sheets.find((s) => s.id === activePivot.sheetId) ?? null
    : null;
  const pivotEffectiveRange = activePivot
    ? (activePivot.adjustedRange ?? activePivot.sourceRange ?? '')
    : '';
  const pivotHeaderTexts =
    activePivot && pivotSourceSheet
      ? headerTextsInRange(pivotSourceSheet, pivotEffectiveRange)
      : [];
  // Draft field layout of the active pivot editor. When the active pivot
  // differs from the draft (first visit / tab switch), the persisted config
  // (or sensible defaults for a fresh pivot) is used.
  const pivotRowField =
    pivotEditor && activePivot && pivotEditor.pivotId === activePivot.id
      ? pivotEditor.rowField
      : activePivot?.config?.rowField ?? pivotHeaderTexts[0] ?? '';
  const pivotColumnField =
    pivotEditor && activePivot && pivotEditor.pivotId === activePivot.id
      ? pivotEditor.columnField
      : activePivot?.config?.columnField ?? '';
  const pivotValueField =
    pivotEditor && activePivot && pivotEditor.pivotId === activePivot.id
      ? pivotEditor.valueField
      : activePivot?.config?.valueField ??
        pivotHeaderTexts[1] ??
        pivotHeaderTexts[0] ??
        '';
  const pivotSummarizeBy =
    pivotEditor && activePivot && pivotEditor.pivotId === activePivot.id
      ? pivotEditor.summarizeBy
      : activePivot?.config?.summarizeBy ?? 'SUM';

  return (
    <main className="editor-page">
      <header className="editor-header">
        <div className="editor-title-row">
          <div className="editor-title-line">
            <h1>{workbook.name}</h1>
            <button
              type="button"
              className="rename-workbook-button"
              aria-expanded={renaming}
              onClick={toggleRename}
            >
              Rename workbook
            </button>
          </div>
          <p>Last updated: {formatLastUpdated(workbook.lastUpdated)}</p>
          {renaming && (
            <form className="rename-workbook-form" onSubmit={submitRename}>
              <label htmlFor="rename-workbook-name">Workbook name</label>
              <input
                id="rename-workbook-name"
                className="rename-workbook-input"
                value={renameName}
                onChange={(event) => setRenameName(event.target.value)}
                autoFocus
              />
              {renameError && (
                <p className="form-error" role="alert">
                  {renameError}
                </p>
              )}
              <button
                type="submit"
                className="rename-save-button"
                disabled={renameSaving}
              >
                Save
              </button>
            </form>
          )}
        </div>
        <a className="back-link" href="#/">
          Back to workbooks
        </a>
      </header>

      <div className="editor-toolbar" role="toolbar" aria-label="Workbook toolbar">
        <button
          type="button"
          className="toolbar-button"
          onClick={handleUndo}
          disabled={!canUndo}
        >
          Undo
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={handleRedo}
          disabled={!canRedo}
        >
          Redo
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={() => copyRange('copy')}
        >
          Copy
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={() => copyRange('cut')}
        >
          Cut
        </button>
        <button type="button" className="toolbar-button" onClick={handleToolbarPaste}>
          Paste
        </button>
        <div className="data-menu-wrapper">
          <button
            type="button"
            className="toolbar-button"
            aria-haspopup="menu"
            aria-expanded={openDataMenu ? 'true' : 'false'}
            data-data-trigger
            onClick={toggleDataMenu}
          >
            Data
          </button>
          {openDataMenu && (
            <div
              role="menu"
              aria-label="Data menu"
              className="data-menu"
              data-data-menu
              onKeyDown={handleDataMenuKeyDown}
            >
              <button
                type="button"
                role="menuitem"
                className="data-menu-item"
                data-data-menu-item
                autoFocus
                onClick={openSortDialog}
                onKeyDown={handleDataMenuItemKeyDown}
              >
                Sort range
              </button>
              <button
                type="button"
                role="menuitem"
                className="data-menu-item"
                data-data-menu-item
                onClick={handleCreateFilter}
                onKeyDown={handleDataMenuItemKeyDown}
              >
                Create filter
              </button>
              <button
                type="button"
                role="menuitem"
                className="data-menu-item"
                data-data-menu-item
                onClick={openCreatePivotDialog}
                onKeyDown={handleDataMenuItemKeyDown}
              >
                Create pivot table
              </button>
              <button
                type="button"
                role="menuitem"
                className="data-menu-item"
                data-data-menu-item
                onClick={openValidationDialog}
                onKeyDown={handleDataMenuItemKeyDown}
              >
                Data validation
              </button>
              <button
                type="button"
                role="menuitem"
                className="data-menu-item"
                data-data-menu-item
                onClick={handleClearFilter}
                onKeyDown={handleDataMenuItemKeyDown}
              >
                Clear filter
              </button>
            </div>
          )}
        </div>
        <button type="button" className="export-csv-button" onClick={handleExportCsv}>
          Export CSV
        </button>
      </div>

      <div role="tablist" aria-label="Worksheets" className="sheet-tabs">
        {workbook.sheets.map((sheet) => (
          <div
            key={sheet.id}
            role="none"
            className={'sheet-tab' + (sheet.id === activeSheet.id ? ' active' : '')}
          >
            <button
              type="button"
              role="tab"
              aria-selected={sheet.id === activeSheet.id ? 'true' : 'false'}
              className="sheet-tab-button"
              onClick={() => {
                closeSheetMenu();
                handleTabSelect(sheet.id);
              }}
            >
              {sheet.name}
            </button>
            <button
              type="button"
              className="sheet-options-button"
              aria-label={`Worksheet options for ${sheet.name}`}
              aria-haspopup="menu"
              aria-expanded={openSheetMenu === sheet.id ? 'true' : 'false'}
              data-sheet-options={sheet.id}
              onClick={() => toggleSheetMenu(sheet.id)}
            >
              <span aria-hidden="true">▾</span>
            </button>
            {openSheetMenu === sheet.id && (
              <div
                className="sheet-menu"
                role="menu"
                aria-label={`Options for ${sheet.name}`}
                data-sheet-menu={sheet.id}
                onKeyDown={(event) => handleSheetMenuKeyDown(event, sheet.id)}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="sheet-menu-item"
                  data-sheet-menu-item
                  autoFocus
                  onClick={() => openRenameDialog(sheet)}
                  onKeyDown={(event) => handleSheetMenuItemKeyDown(event, sheet.id)}
                >
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="sheet-menu-item"
                  data-sheet-menu-item
                  onClick={() => openDeleteDialog(sheet)}
                  onKeyDown={(event) => handleSheetMenuItemKeyDown(event, sheet.id)}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
        <button
          type="button"
          className="add-worksheet-button"
          onClick={handleAddWorksheet}
        >
          Add worksheet
        </button>
      </div>

      {deleteSheetError && (
        <div className="sheet-delete-error" role="alert">
          {deleteSheetError}
        </div>
      )}

      <div className="formula-bar">
        <span className="cell-reference" aria-label="Selected cell">
          {selection.active}
        </span>
        <label htmlFor="formula-bar-input">Formula bar</label>
        <input
          id="formula-bar-input"
          className="formula-input"
          value={selectedCellValue}
          onChange={(event) => handleFormulaBarChange(event.target.value)}
          onFocus={() => handleEditStart(selection.active, selectedCellValue)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              handleRevertCell(selection.active);
            }
          }}
        />
        {saveError && (
          <span className="save-error" role="alert">
            {saveError}
          </span>
        )}
      </div>

      <WorksheetGrid
        sheet={activeSheet}
        selection={selection}
        filter={activeFilterOf(activeSheet)}
        onOpenHeaderFilter={openFilterDialog}
        rowMenuRow={rowMenuRow}
        onRowHeaderMenu={openRowMenu}
        onRowMenuAction={handleRowMenuAction}
        onRowMenuKeyDown={handleRowMenuKeyDown}
        colMenuCol={colMenuCol}
        onColHeaderMenu={openColMenu}
        onColMenuAction={handleColMenuAction}
        onColMenuKeyDown={handleColMenuKeyDown}
        onCellActivate={handleCellActivate}
        onCellDrag={handleCellDrag}
        onCellValueChange={handleCellValueChange}
        onRevertCell={handleRevertCell}
        onEditStart={handleEditStart}
        onMoveSelection={moveSelection}
        onCommitMove={handleCommitMove}
        onPasteText={handlePasteText}
        onMenuPaste={handleMenuPaste}
        onCopyRange={(event, kind) => copyRange(kind, event)}
        onMenuCopyRange={(kind) => copyRange(kind)}
      />

      {validationError && (
        <div className="validation-error" role="alert">
          {validationError}
        </div>
      )}

      <div className="editor-sections">
        {activePivot && (
          <section
            aria-label="Pivot table editor"
            className="editor-section pivot-editor-section"
          >
            <h2>Pivot table editor</h2>
            <form
              className="pivot-editor-form"
              onSubmit={(event) => {
                event.preventDefault();
                applyPivotConfig();
              }}
            >
              <label htmlFor="pivot-rows-select">Rows</label>
              <select
                id="pivot-rows-select"
                className="pivot-field-select"
                value={pivotRowField}
                onChange={(event) => updatePivotEditor({ rowField: event.target.value })}
              >
                {pivotHeaderTexts.map((header, index) => (
                  <option key={`row-${index}`} value={header}>
                    {header}
                  </option>
                ))}
              </select>
              <label htmlFor="pivot-columns-select">Columns</label>
              <select
                id="pivot-columns-select"
                className="pivot-field-select"
                value={pivotColumnField}
                onChange={(event) => updatePivotEditor({ columnField: event.target.value })}
              >
                <option value="">None</option>
                {pivotHeaderTexts.map((header, index) => (
                  <option key={`col-${index}`} value={header}>
                    {header}
                  </option>
                ))}
              </select>
              <label htmlFor="pivot-values-select">Values</label>
              <select
                id="pivot-values-select"
                className="pivot-field-select"
                value={pivotValueField}
                onChange={(event) => updatePivotEditor({ valueField: event.target.value })}
              >
                {pivotHeaderTexts.map((header, index) => (
                  <option key={`val-${index}`} value={header}>
                    {header}
                  </option>
                ))}
              </select>
              <label htmlFor="pivot-summarize-select">Summarize by</label>
              <select
                id="pivot-summarize-select"
                className="pivot-summarize-select"
                value={pivotSummarizeBy}
                onChange={(event) =>
                  updatePivotEditor({
                    summarizeBy: event.target.value as PivotSummarizeBy,
                  })
                }
              >
                <option value="SUM">SUM</option>
                <option value="COUNT">COUNT</option>
                <option value="AVERAGE">AVERAGE</option>
              </select>
              <div className="pivot-editor-actions">
                <button type="submit" className="pivot-apply-button">
                  Apply
                </button>
                <button
                  type="button"
                  className="refresh-pivot-button"
                  onClick={() => handleRefreshPivot(activePivot.id)}
                >
                  Refresh pivot table
                </button>
              </div>
              {(pivotError?.pivotId === activePivot.id || activePivot.fieldError) && (
                <p className="form-error" role="alert">
                  {activePivot.fieldError
                    ? PIVOT_FIELD_MISSING
                    : (pivotError?.message ?? '')}
                </p>
              )}
            </form>
          </section>
        )}
        <section aria-label="Filter views" className="editor-section">
          <h2>Filter views</h2>
          {activeSheet.filterViews.length === 0 ? (
            <p>No filter views</p>
          ) : (
            <ul>
              {activeSheet.filterViews.map((view) => (
                <li key={view.id}>{view.name}</li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Data validation" className="editor-section">
          <h2>Data validation</h2>
          {activeSheet.validationRules.length === 0 ? (
            <p>No validation rules</p>
          ) : (
            <ul>
              {activeSheet.validationRules.map((rule) => (
                <li key={rule.id}>
                  {rule.range} ({rule.type}
                  {rule.type === 'dropdown'
                    ? `, ${(rule.values ?? []).join(', ')}`
                    : typeof rule.min === 'number' && typeof rule.max === 'number'
                      ? `, ${rule.min} to ${rule.max}`
                      : ''}
                  )
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Pivot table results" className="editor-section">
          <h2>Pivot table results</h2>
          {activeSheetPivots.length === 0 ? (
            <p>No pivot table results</p>
          ) : (
            <ul>
              {activeSheetPivots.map((pivot) => (
                <li key={pivot.id}>
                  {pivot.name}
                  {pivot.sourceRange ? ` (${pivot.sourceRange})` : ''}
                  {pivot.stale && (
                    <button
                      type="button"
                      className="refresh-pivot-button"
                      onClick={() => handleRefreshPivot(pivot.id)}
                    >
                      Refresh pivot table
                    </button>
                  )}
                  {pivot.fieldError && (
                    <span className="pivot-field-error" role="alert">
                      {pivot.config
                        ? 'Pivot field is no longer available. Select a new field.'
                        : 'Please reselect the deleted pivot field'}
                    </span>
                  )}
                  {pivotError && pivotError.pivotId === pivot.id && (
                    <span className="pivot-field-error" role="alert">
                      {pivotError.message}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {renameSheetId !== null && (
        <dialog
          ref={renameDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="rename-worksheet-title"
          className="rename-sheet-dialog"
          onClose={handleRenameDialogClose}
        >
          <h2 id="rename-worksheet-title">Rename worksheet</h2>
          <form className="rename-sheet-form" onSubmit={submitSheetRename}>
            <label htmlFor="rename-sheet-name">Worksheet name</label>
            <input
              id="rename-sheet-name"
              className="rename-sheet-input"
              value={renameSheetName}
              onChange={(event) => setRenameSheetName(event.target.value)}
              autoFocus
            />
            {renameSheetError && (
              <p className="form-error" role="alert">
                {renameSheetError}
              </p>
            )}
            <button
              type="submit"
              className="rename-sheet-save"
              disabled={renameSheetSaving}
            >
              Save
            </button>
          </form>
        </dialog>
      )}

      {deleteSheetId !== null &&
        (() => {
          const target = workbook.sheets.find((s) => s.id === deleteSheetId);
          return (
            <dialog
              ref={deleteDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-worksheet-title"
              className="delete-sheet-dialog"
              onClose={handleDeleteDialogClose}
            >
              <h2 id="delete-worksheet-title">Delete worksheet</h2>
              <p className="delete-sheet-description">
                Delete worksheet {target ? target.name : ''}? This cannot be
                undone.
              </p>
              <form className="delete-sheet-form" onSubmit={confirmDeleteSheet}>
                <button
                  type="submit"
                  className="delete-sheet-confirm"
                  disabled={deleteSheetSaving}
                >
                  Delete worksheet
                </button>
                <button
                  type="button"
                  className="delete-sheet-cancel"
                  onClick={closeDeleteDialog}
                >
                  Cancel
                </button>
              </form>
            </dialog>
          );
        })()}

      {filterDialogColumn !== null &&
        (() => {
          const filter = activeFilterOf(activeSheet);
          const range = filter && filter.range ? parseRange(filter.range) : null;
          const headerRow = range ? range.startRow : -1;
          const headerText =
            headerRow >= 0
              ? (activeSheet.cells[coordinateToCell(headerRow, filterDialogColumn)] ?? '')
              : '';
          const conditionNeedsValue =
            filterCondition === 'text-contains' ||
            filterCondition === 'greater-than' ||
            filterCondition === 'before';
          return (
            <dialog
              ref={filterDialogRef}
              role="dialog"
              aria-modal="true"
              aria-label={`Filter ${headerText}`}
              className="filter-dialog"
              onClose={handleFilterDialogClose}
            >
              <h2>Filter {headerText}</h2>
              <div className="filter-values-section">
                <button
                  type="button"
                  className="filter-clear-selection"
                  onClick={() => setFilterCheckedValues([])}
                >
                  Clear selection
                </button>
                <div className="filter-checkbox-list">
                  {filterDistinctValues.map((value) => (
                    <label key={value} className="filter-checkbox-label">
                      <input
                        type="checkbox"
                        checked={filterCheckedValues.includes(value)}
                        onChange={(event) => {
                          setFilterCheckedValues((prev) =>
                            event.target.checked
                              ? [...prev, value]
                              : prev.filter((v) => v !== value)
                          );
                        }}
                      />
                      {value}
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  className="filter-apply-values"
                  onClick={handleApplyValueFilter}
                >
                  Apply
                </button>
              </div>
              <div className="filter-condition-section">
                <label htmlFor="filter-condition-select">Condition</label>
                <select
                  id="filter-condition-select"
                  value={filterCondition}
                  onChange={(event) =>
                    setFilterCondition(event.target.value as FilterCondition)
                  }
                >
                  <option value="text-contains">Text contains</option>
                  <option value="greater-than">Greater than</option>
                  <option value="before">Before</option>
                  <option value="is-empty">Is empty</option>
                  <option value="is-not-empty">Is not empty</option>
                </select>
                {conditionNeedsValue && (
                  <>
                    <label htmlFor="filter-value-input">Value</label>
                    <input
                      id="filter-value-input"
                      className="filter-value-input"
                      value={filterConditionValue}
                      onChange={(event) => setFilterConditionValue(event.target.value)}
                    />
                  </>
                )}
                <button
                  type="button"
                  className="filter-apply-condition"
                  onClick={handleApplyConditionFilter}
                >
                  Apply
                </button>
              </div>
            </dialog>
          );
        })()}

      {validationDialogOpen && (
        <dialog
          ref={validationDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="data-validation-title"
          className="validation-dialog"
          onClose={handleValidationDialogClose}
        >
          <h2 id="data-validation-title">Data validation</h2>
          <form className="validation-form" onSubmit={submitValidationRule}>
            <label htmlFor="validation-rule-type">Rule type</label>
            <select
              id="validation-rule-type"
              value={validationRuleType}
              onChange={(event) =>
                setValidationRuleType(event.target.value as 'dropdown' | 'number')
              }
            >
              <option value="dropdown">Dropdown</option>
              <option value="number">Number range</option>
            </select>
            {validationRuleType === 'dropdown' ? (
              <>
                <label htmlFor="validation-allowed-values">Allowed values</label>
                <input
                  id="validation-allowed-values"
                  className="validation-values-input"
                  value={validationAllowedValues}
                  onChange={(event) => setValidationAllowedValues(event.target.value)}
                />
              </>
            ) : (
              <>
                <label htmlFor="validation-min">Minimum</label>
                <input
                  id="validation-min"
                  className="validation-number-input"
                  value={validationMin}
                  onChange={(event) => setValidationMin(event.target.value)}
                />
                <label htmlFor="validation-max">Maximum</label>
                <input
                  id="validation-max"
                  className="validation-number-input"
                  value={validationMax}
                  onChange={(event) => setValidationMax(event.target.value)}
                />
              </>
            )}
            {validationDialogError && (
              <p className="form-error" role="alert">
                {validationDialogError}
              </p>
            )}
            <div className="validation-actions">
              {validationEditingRule && (
                <button
                  type="button"
                  className="delete-rule-button"
                  onClick={handleDeleteValidationRule}
                  disabled={validationSaving}
                >
                  Delete rule
                </button>
              )}
              <button
                type="submit"
                className="validation-save-button"
                disabled={validationSaving}
              >
                Save
              </button>
            </div>
          </form>
        </dialog>
      )}

      {sortDialogOpen && (
        <dialog
          ref={sortDialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Sort range"
          className="sort-dialog"
          onClose={handleSortDialogClose}
        >
          <h2>Sort range</h2>
          <form className="sort-form" onSubmit={submitSort}>
            <label htmlFor="sort-by-select">Sort by</label>
            <select
              id="sort-by-select"
              className="sort-by-select"
              value={sortByColumn}
              onChange={(event) => setSortByColumn(Number(event.target.value))}
            >
              {sortColumns.map((entry) => (
                <option key={entry.column} value={entry.column}>
                  {entry.header}
                </option>
              ))}
            </select>
            <label htmlFor="sort-order-select">Order</label>
            <select
              id="sort-order-select"
              className="sort-order-select"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value as SortOrder)}
            >
              <option value="ascending">Ascending</option>
              <option value="descending">Descending</option>
            </select>
            <label className="sort-header-checkbox">
              <input
                type="checkbox"
                checked={sortHasHeader}
                onChange={(event) => setSortHasHeader(event.target.checked)}
              />
              Data has header row
            </label>
            {sortDialogError && (
              <p className="form-error" role="alert">
                {sortDialogError}
              </p>
            )}
            <button
              type="submit"
              className="sort-submit-button"
              disabled={sortSaving}
            >
              Sort
            </button>
          </form>
        </dialog>
      )}

      {createPivotDialogOpen && (
        <dialog
          ref={createPivotDialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Create pivot table"
          className="create-pivot-dialog"
          onClose={handleCreatePivotDialogClose}
        >
          <h2>Create pivot table</h2>
          <p className="pivot-source-range">Source range: {createPivotRange}</p>
          <form className="create-pivot-form" onSubmit={submitCreatePivot}>
            <label className="pivot-destination-option">
              <input
                type="radio"
                name="pivot-destination"
                value="new-worksheet"
                defaultChecked
              />
              New worksheet
            </label>
            <div className="pivot-create-actions">
              <button type="submit" className="create-pivot-button">
                Create
              </button>
            </div>
          </form>
        </dialog>
      )}
    </main>
  );
}

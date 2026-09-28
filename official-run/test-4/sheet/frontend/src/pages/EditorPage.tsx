import { useEffect, useRef, useState } from "react";

import { FilterDialog } from "../components/FilterDialog";
import { DeleteSheetDialog } from "../components/DeleteSheetDialog";
import { Grid } from "../components/Grid";
import { Menu, type MenuAction } from "../components/Menu";
import { PivotCreateDialog } from "../components/PivotCreateDialog";
import { PivotEditor } from "../components/PivotEditor";
import { RenameDialog } from "../components/RenameDialog";
import { RenameSheetDialog } from "../components/RenameSheetDialog";
import { SortDialog } from "../components/SortDialog";
import { ValidationDialog } from "../components/ValidationDialog";
import { downloadText } from "../lib/download";
import { distinctValues, type ColumnFilter } from "../lib/filter";
import { cellName, columnName, formatDateTime, normalizeRange, parseCoord, parsePasteText, rangeColumns, rangeTopRow, type CellRange } from "../lib/spreadsheet";
import {
  addSheet,
  applyPivotConfig,
  captureClipboard,
  createPivotTable,
  deleteColumn,
  deleteRow,
  deleteSheet,
  deleteValidationRule,
  errorMessage,
  exportCsvUrl,
  getWorkbook,
  insertColumn,
  insertRow,
  pasteClipboard,
  redoWorkbook,
  refreshPivot,
  renameSheet,
  renameWorkbook,
  saveValidationRule,
  sortRange,
  undoWorkbook,
  updateCells,
  updateFilter,
  updateState,
  type ClipboardKind,
  type ColumnPosition,
  type PivotConfigPayload,
  type RowPosition,
  type SheetState,
  type SortPayload,
  type ValidationRule,
  type ValidationRulePayload,
  type Workbook,
} from "../lib/workbooks";

interface EditorPageProps {
  workbookId: string;
}

interface SheetMenuState {
  sheetId: string;
  x: number;
  y: number;
}

interface FilterDialogState {
  column: string;
  headerText: string;
}

interface Point {
  x: number;
  y: number;
}

export function EditorPage({ workbookId }: EditorPageProps) {
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameSheetTarget, setRenameSheetTarget] = useState<SheetState | null>(null);
  const [deleteSheetTarget, setDeleteSheetTarget] = useState<SheetState | null>(null);
  const [sheetMenu, setSheetMenu] = useState<SheetMenuState | null>(null);
  const [dataMenu, setDataMenu] = useState<Point | null>(null);
  const [filterDialog, setFilterDialog] = useState<FilterDialogState | null>(null);
  const [validationOpen, setValidationOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [pivotCreateOpen, setPivotCreateOpen] = useState(false);
  const [formulaDraft, setFormulaDraft] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [mutating, setMutating] = useState(false);
  const sheetMenuTriggerRef = useRef<HTMLElement | null>(null);
  const dataMenuTriggerRef = useRef<HTMLElement | null>(null);
  const pendingCommitsRef = useRef(new Set<Promise<void>>());

  useEffect(() => {
    let cancelled = false;
    setWorkbook(null);
    setLoadError(null);
    setCommitError(null);
    setSheetError(null);
    getWorkbook(workbookId)
      .then((loaded) => {
        if (!cancelled) setWorkbook(loaded);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [workbookId, reloadKey]);

  // Ctrl+Z / Ctrl+Y drive undo/redo; Ctrl+C / X / V copy, cut and paste the
  // selected rectangle. Native text editing inside inputs keeps its own key
  // handling, and open dialogs/menus keep their own key handling.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!workbook) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (renameOpen || renameSheetTarget || deleteSheetTarget || sheetMenu || dataMenu || filterDialog || validationOpen || sortOpen || pivotCreateOpen) return;
      const activeSheet =
        workbook.sheets.find((item) => item.id === workbook.activeSheetId) ??
        workbook.sheets[0];
      if (!activeSheet) return;
      const anchor = activeSheet.selectedCell ?? "A1";
      const range = activeSheet.selectedRange ?? { start: anchor, end: anchor };
      const hasRangeClipboard = Boolean(
        workbook.clipboard && workbook.clipboard.sheetId === activeSheet.id,
      );
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        void runHistoryOp(() => undoWorkbook(workbook.id));
      } else if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        void runHistoryOp(() => redoWorkbook(workbook.id));
      } else if (key === "c") {
        event.preventDefault();
        void captureRange("copy", range);
      } else if (key === "x") {
        event.preventDefault();
        void captureRange("cut", range);
      } else if (key === "v") {
        event.preventDefault();
        if (hasRangeClipboard) {
          void handlePasteRange(anchor);
        } else {
          // no session range: fall back to external clipboard text
          void (async () => {
            try {
              if (navigator.clipboard?.readText) {
                const text = await navigator.clipboard.readText();
                if (text !== null && text !== undefined) {
                  void handlePasteText(text, anchor);
                }
              }
            } catch {
              // clipboard access denied; nothing to paste
            }
          })();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const activeSheet = workbook?.sheets.find((sheet) => sheet.id === workbook.activeSheetId)
    ?? workbook?.sheets[0]
    ?? null;

  if (loadError) {
    return (
      <main className="editor-page">
        <h1>Workbook</h1>
        <p role="alert">{loadError}</p>
        <button onClick={() => setReloadKey((key) => key + 1)}>Try again</button>
        <p>
          <a href="#/">Back to home</a>
        </p>
      </main>
    );
  }

  if (!workbook || !activeSheet) {
    return (
      <main className="editor-page">
        <p role="status">Loading workbook…</p>
      </main>
    );
  }

  const wb = workbook;
  const sheet = activeSheet;
  const selectedCell = sheet.selectedCell ?? "A1";
  const selectedValue = sheet.cells[selectedCell] ?? "";
  const selectedRange: CellRange = sheet.selectedRange ?? {
    start: selectedCell,
    end: selectedCell,
  };
  const results = sheet.results ?? {};

  async function commitCell(coord: string, value: string) {
    setCommitError(null);
    const pending = (async () => {
      try {
        const updated = await updateCells(wb.id, sheet.id, { [coord]: value });
        // The response carries the backend-persisted selection; keep the
        // selection the user made locally (it may have moved to another cell).
        setWorkbook((current) => {
          if (!current) return updated;
          const currentSheet = current.sheets.find((item) => item.id === sheet.id);
          if (!currentSheet) return updated;
          return {
            ...updated,
            sheets: updated.sheets.map((item) =>
              item.id === sheet.id
                ? {
                    ...item,
                    selectedCell: currentSheet.selectedCell,
                    selectedRange: currentSheet.selectedRange,
                  }
                : item,
            ),
          };
        });
      } catch (error) {
        setCommitError(errorMessage(error));
      }
    })();
    pendingCommitsRef.current.add(pending);
    void pending.finally(() => pendingCommitsRef.current.delete(pending));
    await pending;
  }

  function selectCell(coord: string) {
    setWorkbook((current) =>
      current
        ? {
            ...current,
            sheets: current.sheets.map((item) =>
              item.id === sheet.id
                ? {
                    ...item,
                    selectedCell: coord,
                    selectedRange: { start: coord, end: coord },
                  }
                : item,
            ),
          }
        : current,
    );
    void updateState(wb.id, sheet.id, coord, { start: coord, end: coord }).catch(
      () => undefined,
    );
  }

  /** Select a complete rectangle (drag) and persist the whole rectangle. */
  function selectRange(start: string, end: string) {
    setWorkbook((current) =>
      current
        ? {
            ...current,
            sheets: current.sheets.map((item) =>
              item.id === sheet.id
                ? {
                    ...item,
                    selectedCell: start,
                    selectedRange: { start, end },
                  }
                : item,
            ),
          }
        : current,
    );
    void updateState(wb.id, sheet.id, start, { start, end }).catch(() => undefined);
  }

  /**
   * Paste external clipboard text as a two-dimensional table starting at the
   * given cell. The full rectangle is submitted atomically: either every cell
   * is applied and persisted, or an error is shown and all targets keep their
   * original values.
   */
  async function handlePasteText(text: string, target: string) {
    const matrix = parsePasteText(text);
    if (matrix.length === 0) return;
    const position = parseCoord(target);
    if (!position) return;
    const updates: Record<string, string> = {};
    matrix.forEach((row, rowIndex) => {
      row.forEach((value, columnIndex) => {
        updates[cellName(position.row + rowIndex, position.col + columnIndex)] = value;
      });
    });
    setCommitError(null);
    try {
      const updated = await updateCells(wb.id, sheet.id, updates);
      setWorkbook(updated);
    } catch (error) {
      setCommitError(errorMessage(error));
    }
  }

  function switchSheet(sheetId: string) {
    const target = wb.sheets.find((item) => item.id === sheetId);
    if (!target || target.id === sheet.id) return;
    setFormulaDraft(null);
    setSheetError(null);
    setWorkbook((current) => (current ? { ...current, activeSheetId: sheetId } : current));
    void updateState(
      wb.id,
      sheetId,
      target.selectedCell,
      target.selectedRange ?? { start: target.selectedCell, end: target.selectedCell },
    ).catch(() => undefined);
  }

  /** Runs a workbook-structure mutation with busy guarding and error surfacing. */
  async function mutateSheet(operation: () => Promise<Workbook>) {
    if (mutating) return;
    setMutating(true);
    setSheetError(null);
    try {
      const updated = await operation();
      setWorkbook(updated);
    } catch (error) {
      setSheetError(errorMessage(error));
    } finally {
      setMutating(false);
    }
  }

  /** Runs a session-history operation (undo/redo) with busy guarding. */
  async function runHistoryOp(operation: () => Promise<Workbook>) {
    if (mutating) return;
    setMutating(true);
    setCommitError(null);
    setFormulaDraft(null);
    try {
      const updated = await operation();
      setWorkbook(updated);
    } catch (error) {
      setCommitError(errorMessage(error));
    } finally {
      setMutating(false);
    }
  }

  /** Capture the current selection into the session clipboard (copy/cut). */
  async function captureRange(kind: ClipboardKind, range: CellRange) {
    setCommitError(null);
    try {
      const updated = await captureClipboard(wb.id, sheet.id, kind, range);
      setWorkbook(updated);
    } catch (error) {
      setCommitError(errorMessage(error));
    }
  }

  /** Paste the session clipboard so the rectangle starts at the target cell. */
  async function handlePasteRange(target: string) {
    setCommitError(null);
    try {
      const updated = await pasteClipboard(wb.id, sheet.id, target);
      setWorkbook(updated);
    } catch (error) {
      setCommitError(errorMessage(error));
    }
  }

  function handleAddSheet() {
    setFormulaDraft(null);
    void mutateSheet(() => addSheet(wb.id));
  }

  function openSheetMenu(sheetId: string, event: React.MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    sheetMenuTriggerRef.current = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    setSheetMenu({ sheetId, x: rect.left, y: rect.bottom + 2 });
  }

  function closeSheetMenu() {
    setSheetMenu(null);
    sheetMenuTriggerRef.current?.focus();
    sheetMenuTriggerRef.current = null;
  }

  /** Open the toolbar "Data" menu (REQ-5). */
  function openDataMenu(event: React.MouseEvent<HTMLButtonElement>) {
    dataMenuTriggerRef.current = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    setDataMenu({ x: rect.left, y: rect.bottom + 2 });
  }

  function closeDataMenu() {
    setDataMenu(null);
    dataMenuTriggerRef.current?.focus();
    dataMenuTriggerRef.current = null;
  }

  /** Create a filter for the selected rectangle (REQ-5-1-2). */
  async function createFilter() {
    setCommitError(null);
    try {
      const updated = await updateFilter(wb.id, sheet.id, {
        start: selectedRange.start,
        end: selectedRange.end,
        columns: {},
      });
      setWorkbook(updated);
    } catch (error) {
      setCommitError(errorMessage(error));
    }
  }

  /** Clear the active filter, restoring every source row (REQ-5-1-2). */
  async function clearFilter() {
    setCommitError(null);
    try {
      const updated = await updateFilter(wb.id, sheet.id, null);
      setWorkbook(updated);
    } catch (error) {
      setCommitError(errorMessage(error));
    }
  }

  /** Persist one column's filter inside the active filter rectangle. */
  async function applyColumnFilter(column: string, columnFilter: ColumnFilter) {
    if (!sheet.filter) return;
    const columns = { ...sheet.filter.columns, [column]: columnFilter };
    const updated = await updateFilter(wb.id, sheet.id, {
      start: sheet.filter.start,
      end: sheet.filter.end,
      columns,
    });
    setWorkbook(updated);
  }

  /** Save a dropdown/numeric validation rule for the selection (REQ-5-2-1). */
  async function saveValidation(payload: ValidationRulePayload) {
    const updated = await saveValidationRule(wb.id, sheet.id, payload);
    setWorkbook(updated);
  }

  /** Delete the reopened validation rule (REQ-5-2-1). */
  async function removeValidation(ruleId: string) {
    const updated = await deleteValidationRule(wb.id, sheet.id, ruleId);
    setWorkbook(updated);
  }

  /** The rule the dialog was opened on: exact range match first, else overlap. */
  function ruleForRange(rules: ValidationRule[], range: CellRange): ValidationRule | null {
    const exact = rules.find((rule) => rule.start === range.start && rule.end === range.end);
    if (exact) return exact;
    return rules.find((rule) => {
      const from = parseCoord(rule.start);
      const to = parseCoord(rule.end);
      if (!from || !to) return false;
      const selectionFrom = parseCoord(range.start);
      const selectionTo = parseCoord(range.end);
      if (!selectionFrom || !selectionTo) return false;
      return !(
        Math.max(from.row, to.row) < Math.min(selectionFrom.row, selectionTo.row) ||
        Math.max(selectionFrom.row, selectionTo.row) < Math.min(from.row, to.row) ||
        Math.max(from.col, to.col) < Math.min(selectionFrom.col, selectionTo.col) ||
        Math.max(selectionFrom.col, selectionTo.col) < Math.min(from.col, to.col)
      );
    }) ?? null;
  }

  async function saveSheetRename(sheetId: string, name: string) {
    const updated = await renameSheet(wb.id, sheetId, name);
    setWorkbook(updated);
  }

  /**
   * Delete the confirmed worksheet (REQ-2-1-4). The confirmation dialog
   * closes for both outcomes: success activates an adjacent worksheet, a
   * rejection (for example the sheet is still a pivot source) surfaces the
   * error while source data and pivot results stay unchanged.
   */
  async function handleDeleteSheet(sheetId: string) {
    setDeleteSheetTarget(null);
    setFormulaDraft(null);
    void mutateSheet(() => deleteSheet(wb.id, sheetId));
  }

  function handleInsertRow(index: number, position: RowPosition) {
    void mutateSheet(() => insertRow(wb.id, sheet.id, index, position));
  }

  function handleDeleteRow(index: number) {
    void mutateSheet(() => deleteRow(wb.id, sheet.id, index));
  }

  function handleInsertColumn(index: number, position: ColumnPosition) {
    void mutateSheet(() => insertColumn(wb.id, sheet.id, index, position));
  }

  function handleDeleteColumn(index: number) {
    void mutateSheet(() => deleteColumn(wb.id, sheet.id, index));
  }

  async function saveRename(name: string) {
    const updated = await renameWorkbook(wb.id, name);
    setWorkbook(updated);
  }

  async function handleExport() {
    setExportError(null);
    try {
      // Wait for any edit that is still being committed (for example a
      // formula-bar draft flushed by blur) so the download reflects the
      // latest grid state.
      await Promise.all([...pendingCommitsRef.current]);
      await downloadText(exportCsvUrl(wb.id), `${sheet.name}.csv`, "text/csv;charset=utf-8");
    } catch (error) {
      setExportError(errorMessage(error));
    }
  }

  const formulaValue = formulaDraft ?? selectedValue;

  const sheetMenuActions: MenuAction[] = sheetMenu
    ? [
        {
          label: "Rename",
          onSelect: () => {
            const target = wb.sheets.find((item) => item.id === sheetMenu.sheetId) ?? null;
            setRenameSheetTarget(target);
          },
        },
        {
          label: "Delete",
          onSelect: () => {
            const target = wb.sheets.find((item) => item.id === sheetMenu.sheetId) ?? null;
            if (!target) return;
            // A workbook must keep at least one worksheet: deleting the last
            // one never opens the confirmation dialog (REQ-2-1-4).
            if (wb.sheets.length <= 1) {
              setSheetError("A workbook must contain at least one worksheet");
            } else {
              setDeleteSheetTarget(target);
            }
          },
        },
      ]
    : [];

  const dataMenuActions: MenuAction[] = dataMenu
    ? [
        {
          label: sheet.filter ? "Clear filter" : "Create filter",
          onSelect: () => {
            if (sheet.filter) {
              void clearFilter();
            } else {
              void createFilter();
            }
          },
        },
        {
          label: "Data validation",
          onSelect: () => setValidationOpen(true),
        },
        {
          label: "Sort range",
          onSelect: () => setSortOpen(true),
        },
        {
          label: "Create pivot table",
          onSelect: () => setPivotCreateOpen(true),
        },
      ]
    : [];

  /** Sort the selected range by a column of the range (REQ-5-1-1). */
  async function handleSortRange(payload: SortPayload) {
    const updated = await sortRange(wb.id, sheet.id, payload);
    setWorkbook(updated);
  }

  /** Create the pivot-result worksheet for the selected source range. */
  async function handleCreatePivot() {
    const range = normalizeRange(selectedRange.start, selectedRange.end);
    const updated = await createPivotTable(wb.id, sheet.id, range);
    setWorkbook(updated);
  }

  /** Apply a field layout and recompute the pivot summary. */
  async function handleApplyPivot(config: PivotConfigPayload) {
    const updated = await applyPivotConfig(wb.id, sheet.id, config);
    setWorkbook(updated);
  }

  /** Recompute the pivot summary with the stored configuration. */
  async function handleRefreshPivot() {
    const updated = await refreshPivot(wb.id, sheet.id);
    setWorkbook(updated);
  }

  const existingRule = validationOpen ? ruleForRange(sheet.validationRules ?? [], selectedRange) : null;
  const filterValues =
    filterDialog && sheet.filter
      ? distinctValues(sheet.cells, sheet.results ?? {}, sheet.filter, filterDialog.column)
      : [];
  const currentColumnFilter =
    filterDialog && sheet.filter ? sheet.filter.columns[filterDialog.column] : undefined;

  return (
    <main className="editor-page">
      <header className="editor-header">
        <a className="home-link" href="#/">
          Back to home
        </a>
        <div className="editor-title-row">
          <h1 className="editor-title">{wb.name}</h1>
          <div className="editor-toolbar">
            <button type="button" onClick={() => setRenameOpen(true)}>
              Rename workbook
            </button>
            <button
              type="button"
              onClick={() => void runHistoryOp(() => undoWorkbook(wb.id))}
              disabled={mutating || !wb.undoAvailable}
            >
              Undo
            </button>
            <button
              type="button"
              onClick={() => void runHistoryOp(() => redoWorkbook(wb.id))}
              disabled={mutating || !wb.redoAvailable}
            >
              Redo
            </button>
            <button type="button" onClick={() => void handleExport()}>
              Export CSV
            </button>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={dataMenu !== null}
              onClick={openDataMenu}
            >
              Data
            </button>
          </div>
        </div>
        <p className="last-updated">Last updated: {formatDateTime(wb.updatedAt)}</p>
      </header>

      <div className="sheet-tabs" role="tablist" aria-label="Worksheets">
        {wb.sheets.map((item) => (
          <div key={item.id} className="sheet-tab" role="presentation">
            <button
              type="button"
              role="tab"
              aria-selected={item.id === sheet.id}
              onClick={() => switchSheet(item.id)}
            >
              {item.name}
            </button>
            <button
              type="button"
              className="sheet-options-button"
              aria-label={`Worksheet options for ${item.name}`}
              aria-haspopup="menu"
              aria-expanded={sheetMenu?.sheetId === item.id}
              disabled={mutating}
              onClick={(event) => openSheetMenu(item.id, event)}
            >
              ⋮
            </button>
          </div>
        ))}
        <button
          type="button"
          className="add-sheet-button"
          disabled={mutating}
          onClick={handleAddSheet}
        >
          Add worksheet
        </button>
      </div>

      <div className="formula-bar-row">
        <label htmlFor="formula-bar">Formula bar</label>
        <input
          id="formula-bar"
          type="text"
          value={formulaValue}
          onChange={(event) => setFormulaDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              const value = formulaDraft ?? selectedValue;
              setFormulaDraft(null);
              void commitCell(selectedCell, value);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setFormulaDraft(null);
            }
          }}
          onBlur={() => {
            if (formulaDraft !== null && formulaDraft !== selectedValue) {
              const value = formulaDraft;
              setFormulaDraft(null);
              void commitCell(selectedCell, value);
            }
          }}
        />
      </div>

      {commitError && (
        <p role="alert" className="commit-error">
          {commitError}
        </p>
      )}

      {sheetError && (
        <p role="alert" className="commit-error">
          {sheetError}
        </p>
      )}

      {exportError && (
        <p role="alert" className="commit-error">
          {exportError}
        </p>
      )}

      <Grid
        cells={sheet.cells}
        results={results}
        selectedCell={selectedCell}
        selection={selectedRange}
        hasRangeClipboard={Boolean(wb.clipboard && wb.clipboard.sheetId === sheet.id)}
        filter={sheet.filter ?? null}
        validationRules={sheet.validationRules ?? []}
        onSelect={selectCell}
        onSelectRange={selectRange}
        onCommit={(coord, value) => void commitCell(coord, value)}
        onPasteText={(text, target) => void handlePasteText(text, target)}
        onCopyRange={(range) => void captureRange("copy", range)}
        onCutRange={(range) => void captureRange("cut", range)}
        onPasteRange={(target) => void handlePasteRange(target)}
        onInsertRow={handleInsertRow}
        onDeleteRow={handleDeleteRow}
        onInsertColumn={handleInsertColumn}
        onDeleteColumn={handleDeleteColumn}
        onFilterColumn={(column, headerText) =>
          setFilterDialog({ column, headerText })
        }
      />

      {dataMenu && (
        <Menu
          x={dataMenu.x}
          y={dataMenu.y}
          actions={dataMenuActions}
          onClose={closeDataMenu}
        />
      )}

      {filterDialog && sheet.filter && (
        <FilterDialog
          headerText={filterDialog.headerText}
          column={filterDialog.column}
          values={filterValues}
          current={currentColumnFilter}
          onApply={(columnFilter) =>
            applyColumnFilter(filterDialog.column, columnFilter)
          }
          onClose={() => setFilterDialog(null)}
        />
      )}

      {validationOpen && (
        <ValidationDialog
          range={selectedRange}
          existing={existingRule}
          onSave={saveValidation}
          onDelete={removeValidation}
          onClose={() => setValidationOpen(false)}
        />
      )}

      {sortOpen && (
        <SortDialog
          range={selectedRange}
          headers={rangeColumns(selectedRange).map((col) => {
            const coord = cellName(rangeTopRow(selectedRange), col);
            const text = (sheet.cells[coord] ?? "").trim();
            return { column: columnName(col), text: text === "" ? columnName(col) : text };
          })}
          onSort={handleSortRange}
          onClose={() => setSortOpen(false)}
        />
      )}

      {sheet.pivot && (
        <PivotEditor
          workbook={wb}
          sheet={sheet}
          onApply={handleApplyPivot}
          onRefresh={handleRefreshPivot}
        />
      )}

      {pivotCreateOpen && (
        <PivotCreateDialog
          range={normalizeRange(selectedRange.start, selectedRange.end)}
          onCreate={handleCreatePivot}
          onClose={() => setPivotCreateOpen(false)}
        />
      )}

      {sheetMenu && (
        <Menu
          x={sheetMenu.x}
          y={sheetMenu.y}
          actions={sheetMenuActions}
          onClose={closeSheetMenu}
        />
      )}

      {renameSheetTarget && (
        <RenameSheetDialog
          currentName={renameSheetTarget.name}
          onSave={(name) => saveSheetRename(renameSheetTarget.id, name)}
          onClose={() => setRenameSheetTarget(null)}
        />
      )}

      {deleteSheetTarget && (
        <DeleteSheetDialog
          sheetName={deleteSheetTarget.name}
          onConfirm={() => handleDeleteSheet(deleteSheetTarget.id)}
          onClose={() => setDeleteSheetTarget(null)}
        />
      )}

      {renameOpen && (
        <RenameDialog
          currentName={wb.name}
          onSave={saveRename}
          onClose={() => setRenameOpen(false)}
        />
      )}
    </main>
  );
}

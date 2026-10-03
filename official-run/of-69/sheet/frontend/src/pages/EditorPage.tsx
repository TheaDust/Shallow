import { useEffect, useRef, useState } from "react";

import { ApiError } from "../lib/api";
import {
  addWorksheet,
  changeWorksheetStructure,
  clearWorksheetFilter,
  fetchWorkbook,
  setActiveWorksheet,
  setWorksheetFilter,
} from "../domain/workbook-api";
import { downloadWorksheetCsv } from "../domain/csv-export";
import { distinctColumnValues, filterColumns, filterRegionFor, withColumnRule } from "../domain/filter";
import { ruleCoveringRange } from "../domain/validation";
import {
  lastUpdatedText,
  selectionRangeName,
  selectionTopLeft,
  snapshotWorksheet,
  type FilterRule,
  type StructureCommand,
  type Workbook,
} from "../domain/types";
import { DataValidationDialog } from "../editor/DataValidationDialog";
import { CreatePivotTableDialog } from "../editor/CreatePivotTableDialog";
import { DeleteWorksheetDialog, LAST_WORKSHEET_MESSAGE } from "../editor/DeleteWorksheetDialog";
import { FilterDialog, type FilterChoice } from "../editor/FilterDialog";
import { PivotTableEditor } from "../editor/PivotTableEditor";
import { RenameWorkbookDialog } from "../editor/RenameWorkbookDialog";
import { RenameWorksheetDialog } from "../editor/RenameWorksheetDialog";
import { SortDialog } from "../editor/SortDialog";
import { WorksheetGrid } from "../editor/WorksheetGrid";
import { useWorkbookHistory } from "../editor/useWorkbookHistory";
import { useWorksheetEditing } from "../editor/useWorksheetEditing";
import { Button, FormField, Menu, Tabs } from "../ui";

export interface EditorPageProps {
  workbookId: string;
}

export function EditorPage({ workbookId }: EditorPageProps) {
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [worksheetError, setWorksheetError] = useState("");
  const [adding, setAdding] = useState(false);
  const [renameWorksheetId, setRenameWorksheetId] = useState<string | null>(null);
  const [deleteWorksheetId, setDeleteWorksheetId] = useState<string | null>(null);
  const [structureError, setStructureError] = useState("");
  const [structurePending, setStructurePending] = useState(false);
  const [dataError, setDataError] = useState("");
  const [dataPending, setDataPending] = useState(false);
  const [filterColumn, setFilterColumn] = useState<number | null>(null);
  const [validationRange, setValidationRange] = useState<string | null>(null);
  const [sortRange, setSortRange] = useState<string | null>(null);
  const [pivotRange, setPivotRange] = useState<string | null>(null);
  const sortBeforeRef = useRef<ReturnType<typeof snapshotWorksheet> | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setNotice("");
    setWorksheetError("");
    setStructureError("");
    setStructurePending(false);
    setDataError("");
    setDataPending(false);
    setFilterColumn(null);
    setValidationRange(null);
    setSortRange(null);
    setPivotRange(null);
    sortBeforeRef.current = null;
    setRenameWorksheetId(null);
    setDeleteWorksheetId(null);
    setRenameOpen(false);
    fetchWorkbook(workbookId)
      .then((loaded) => {
        if (!active) return;
        setWorkbook(loaded);
        setLoading(false);
      })
      .catch((cause) => {
        if (!active) return;
        setError(cause instanceof ApiError && cause.status === 404 ? "Workbook not found" : "Unable to load the workbook. Please try again.");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workbookId]);

  const activeWorksheet =
    workbook === null
      ? null
      : workbook.worksheets.find((worksheet) => worksheet.id === workbook.activeWorksheetId) ?? workbook.worksheets[0] ?? null;

  const history = useWorkbookHistory({ workbook, setWorkbook });
  const editing = useWorksheetEditing({ workbook, worksheet: activeWorksheet, setWorkbook, onRecord: history.record });

  // Ctrl+Z / Ctrl+Y mirror the toolbar buttons; the handler reads the latest history.
  const historyRef = useRef(history);
  historyRef.current = history;
  useEffect(() => {
    function handleHistoryKey(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        historyRef.current.undo();
      } else if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        historyRef.current.redo();
      }
    }
    window.addEventListener("keydown", handleHistoryKey);
    return () => window.removeEventListener("keydown", handleHistoryKey);
  }, []);

  function selectWorksheet(worksheetId: string) {
    if (!workbook || worksheetId === workbook.activeWorksheetId) return;
    const previousId = workbook.activeWorksheetId;
    setWorkbook({ ...workbook, activeWorksheetId: worksheetId });
    setNotice("");
    setActiveWorksheet(workbook.id, worksheetId)
      .then((updated) => setWorkbook(updated))
      .catch(() => {
        setWorkbook((current) => (current ? { ...current, activeWorksheetId: previousId } : current));
        setNotice("Unable to switch worksheet. Please try again.");
      });
  }

  /**
   * "Delete" opens a confirmation dialog, except when the workbook would be left with no
   * worksheet: that is reported without opening a dialog.
   */
  function requestDeleteWorksheet(worksheetId: string) {
    if (!workbook) return;
    setWorksheetError("");
    if (workbook.worksheets.length <= 1) {
      setWorksheetError(LAST_WORKSHEET_MESSAGE);
      return;
    }
    setDeleteWorksheetId(worksheetId);
  }

  async function addWorksheetTab() {
    if (!workbook || adding) return;
    setAdding(true);
    setWorksheetError("");
    try {
      setWorkbook(await addWorksheet(workbook.id));
    } catch (cause) {
      setWorksheetError(cause instanceof ApiError ? cause.message : "Unable to add the worksheet. Please try again.");
    } finally {
      setAdding(false);
    }
  }

  async function changeStructure(command: StructureCommand) {
    if (!workbook || !activeWorksheet || structurePending) return;
    setStructurePending(true);
    setStructureError("");
    const before = snapshotWorksheet(activeWorksheet);
    try {
      const updated = await changeWorksheetStructure(workbook.id, activeWorksheet.id, command);
      setWorkbook(updated);
      const result = updated.worksheets.find((candidate) => candidate.id === activeWorksheet.id);
      if (result) history.record(activeWorksheet.id, before, snapshotWorksheet(result));
    } catch (cause) {
      // The grid keeps showing the previous structure: the backend rejects the whole change.
      setStructureError(
        cause instanceof ApiError ? cause.message : "Unable to update the row or column structure. Please try again.",
      );
    } finally {
      setStructurePending(false);
    }
  }

  /**
   * Persists the filter view of the active worksheet. The stored region and rules stay
   * the single source of visible rows, so a failure keeps the previous view.
   */
  async function saveFilter(range: string, rules: FilterRule[]) {
    if (!workbook || !activeWorksheet || dataPending) return;
    setDataPending(true);
    setDataError("");
    try {
      setWorkbook(await setWorksheetFilter(workbook.id, activeWorksheet.id, { range, rules }));
      return true;
    } catch (cause) {
      setDataError(cause instanceof ApiError ? cause.message : "Unable to update the filter. Please try again.");
      return false;
    } finally {
      setDataPending(false);
    }
  }

  async function createFilter() {
    if (!activeWorksheet) return;
    const range = filterRegionFor(activeWorksheet, activeWorksheet.selection);
    const done = await saveFilter(range, activeWorksheet.filter?.rules ?? []);
    if (done) setFilterColumn(null);
  }

  async function clearFilter() {
    if (!workbook || !activeWorksheet || dataPending) return;
    setDataPending(true);
    setDataError("");
    try {
      setWorkbook(await clearWorksheetFilter(workbook.id, activeWorksheet.id));
      setFilterColumn(null);
    } catch (cause) {
      setDataError(cause instanceof ApiError ? cause.message : "Unable to clear the filter. Please try again.");
    } finally {
      setDataPending(false);
    }
  }

  function openValidation() {
    if (!activeWorksheet) return;
    setDataError("");
    setValidationRange(selectionRangeName(activeWorksheet.selection));
  }

  /**
   * The sort range starts from the current selection; a single selected cell grows to the
   * contiguous data block exactly like "Create filter", while a selected rectangle is used
   * as-is and never expands to adjacent data.
   */
  function openSort() {
    if (!activeWorksheet) return;
    setDataError("");
    sortBeforeRef.current = snapshotWorksheet(activeWorksheet);
    setSortRange(filterRegionFor(activeWorksheet, activeWorksheet.selection));
  }

  /**
   * "Create pivot table" reads the same source range as "Sort range": the selected
   * rectangle, or the contiguous data block around a single selected cell.
   */
  function openPivotTable() {
    if (!activeWorksheet) return;
    setDataError("");
    setPivotRange(filterRegionFor(activeWorksheet, activeWorksheet.selection));
  }

  function applySort(updated: Workbook) {
    setWorkbook(updated);
    setDataError("");
    const before = sortBeforeRef.current;
    sortBeforeRef.current = null;
    if (before && activeWorksheet) {
      const result = updated.worksheets.find((candidate) => candidate.id === activeWorksheet.id);
      if (result) history.record(activeWorksheet.id, before, snapshotWorksheet(result));
    }
  }

  function applyColumnFilter(choice: FilterChoice) {
    if (!activeWorksheet?.filter || filterColumn === null) return;
    const rule: FilterRule | null =
      choice === null
        ? null
        : choice.mode === "values"
          ? { column: filterColumn, mode: "values", values: choice.values }
          : {
              column: filterColumn,
              mode: "condition",
              condition: choice.condition,
              value: choice.value,
            };
    void saveFilter(activeWorksheet.filter.range, withColumnRule(activeWorksheet.filter, filterColumn, rule))
      .then((done) => {
        if (done) setFilterColumn(null);
      });
  }

  /** Ctrl+V and the menu Paste use the internal range clipboard when one is set. */
  function handleGridPaste(startCell: string, text: string) {
    if (editing.hasInternalRange) {
      editing.pasteRangeInternal(startCell);
      return;
    }
    if (text !== "") editing.paste(startCell, text);
  }

  function handlePasteRequest(startCell: string) {
    if (editing.hasInternalRange) {
      editing.pasteRangeInternal(startCell);
      return;
    }
    editing.pasteFromClipboard(startCell);
  }

  if (loading) {
    return (
      <main className="editor">
        <p role="status">Loading workbook…</p>
      </main>
    );
  }

  if (error || !workbook || !activeWorksheet) {
    return (
      <main className="editor">
        <a className="page-home-link" href="#/">
          Home
        </a>
        <p role="alert">{error || "Workbook not found"}</p>
      </main>
    );
  }

  const renameTarget = workbook.worksheets.find((worksheet) => worksheet.id === renameWorksheetId) ?? null;
  const deleteTarget = workbook.worksheets.find((worksheet) => worksheet.id === deleteWorksheetId) ?? null;
  return (
    <main className="editor">
      <header className="editor__header">
        <a className="page-home-link" href="#/">
          Home
        </a>
        <div className="editor__title-row">
          <h1 className="editor__title">{workbook.name}</h1>
          <Button onClick={() => setRenameOpen(true)}>Rename workbook</Button>
        </div>
        <p className="editor__meta">{lastUpdatedText(workbook.updatedAt)}</p>
      </header>
      <div className="editor__toolbar" role="toolbar" aria-label="Editor toolbar">
        <Menu
          triggerLabel="Data"
          menuLabel="Data"
          items={[
            { id: "data-sort-range", label: "Sort range", onSelect: openSort },
            { id: "data-create-filter", label: "Create filter", onSelect: () => void createFilter() },
            { id: "data-clear-filter", label: "Clear filter", onSelect: () => void clearFilter() },
            { id: "data-validation", label: "Data validation", onSelect: openValidation },
            { id: "data-create-pivot-table", label: "Create pivot table", onSelect: openPivotTable },
          ]}
        />
        <Button onClick={() => editing.copyRange()} disabled={editing.pending}>
          Copy
        </Button>
        <Button onClick={() => editing.cutRange()} disabled={editing.pending}>
          Cut
        </Button>
        <Button
          onClick={() => handlePasteRequest(selectionTopLeft(activeWorksheet.selection))}
          disabled={editing.pending}
        >
          Paste
        </Button>
        <Button onClick={() => history.undo()} disabled={!history.canUndo || history.pending}>
          Undo
        </Button>
        <Button onClick={() => history.redo()} disabled={!history.canRedo || history.pending}>
          Redo
        </Button>
        <Button
          onClick={() =>
            downloadWorksheetCsv({
              workbookId: workbook.id,
              workbookName: workbook.name,
              worksheetId: activeWorksheet.id,
              worksheetName: activeWorksheet.name,
            })
          }
        >
          Export CSV
        </Button>
      </div>
      <div className="formula-bar">
        <FormField id="formula-bar" label="Formula bar">
          <input
            id="formula-bar"
            type="text"
            value={editing.formulaBarValue}
            onChange={(event) => editing.updateDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                editing.commit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                editing.cancel();
              }
            }}
            onBlur={() => editing.commit()}
          />
        </FormField>
        {editing.error ? <p role="alert">{editing.error}</p> : null}
        {editing.pending ? <p role="status">Saving…</p> : null}
      </div>
      <Tabs
        label="Worksheets"
        activeId={activeWorksheet.id}
        onChange={selectWorksheet}
        actions={
          <Button onClick={addWorksheetTab} disabled={adding}>
            Add worksheet
          </Button>
        }
        renderItemAccessory={(item) => (
          <Menu
            triggerLabel={`Worksheet options for ${item.label}`}
            items={[
              {
                id: `${item.id}-rename`,
                label: "Rename",
                onSelect: () => {
                  setWorksheetError("");
                  setRenameWorksheetId(item.id);
                },
              },
              {
                id: `${item.id}-delete`,
                label: "Delete",
                tone: "danger",
                onSelect: () => requestDeleteWorksheet(item.id),
              },
            ]}
          />
        )}
        items={workbook.worksheets.map((worksheet) => ({
          id: worksheet.id,
          label: worksheet.name,
          panel: (
            <>
              {worksheet.pivot ? (
                <PivotTableEditor
                  key={worksheet.id}
                  workbookId={workbook.id}
                  workbook={workbook}
                  worksheet={worksheet}
                  onUpdated={(updated) => {
                    setWorkbook(updated);
                    setDataError("");
                  }}
                />
              ) : null}
              <WorksheetGrid
                worksheet={worksheet}
                structureDisabled={structurePending || editing.pending}
                onStructureCommand={changeStructure}
                editing={editing.draft?.source === "grid" ? { cell: editing.draft.cell, input: editing.draft.input } : null}
                onStartEdit={(cell, input) => editing.beginGridEdit(cell, input)}
                onInputChange={(input) => editing.updateDraft(input)}
                onCommitEdit={() => editing.commit()}
                onCancelEdit={() => editing.cancel()}
                onSelect={(selection) => editing.select(selection)}
                onPaste={handleGridPaste}
                onPasteRequest={handlePasteRequest}
                onCopy={() => editing.copyRange()}
                onCut={() => editing.cutRange()}
                onOpenFilter={(column) => {
                  setDataError("");
                  setFilterColumn(column);
                }}
                onSelectDropdownValue={(cell, value) => editing.setValue(cell, value)}
                clipboardRange={
                  editing.clipboard && editing.clipboard.worksheetId === worksheet.id
                    ? { mode: editing.clipboard.mode, source: editing.clipboard.source }
                    : null
                }
              />
            </>
          ),
        }))}
      />
      {filterColumn !== null && activeWorksheet.filter ? (
        <FilterDialog
          key={`${activeWorksheet.id}-${filterColumn}`}
          headerText={
            filterColumns(activeWorksheet).find((entry) => entry.column === filterColumn)?.header ?? ""
          }
          values={distinctColumnValues(activeWorksheet, activeWorksheet.filter, filterColumn)}
          rule={
            activeWorksheet.filter.rules.find((rule) => rule.column === filterColumn) ?? null
          }
          error={dataError || undefined}
          onApply={applyColumnFilter}
          onOpenChange={(open) => {
            if (!open) {
              setFilterColumn(null);
              setDataError("");
            }
          }}
        />
      ) : null}
      {sortRange !== null ? (
        <SortDialog
          key={`${activeWorksheet.id}-${sortRange}`}
          workbookId={workbook.id}
          worksheet={activeWorksheet}
          range={sortRange}
          onOpenChange={(open) => {
            if (!open) {
              setSortRange(null);
              setDataError("");
            }
          }}
          onSorted={applySort}
        />
      ) : null}
      {validationRange !== null ? (
        <DataValidationDialog
          key={`${activeWorksheet.id}-${validationRange}-${activeWorksheet.validations?.length ?? 0}`}
          workbookId={workbook.id}
          worksheet={activeWorksheet}
          range={validationRange}
          rule={ruleCoveringRange(activeWorksheet, validationRange)}
          onOpenChange={(open) => {
            if (!open) setValidationRange(null);
          }}
          onSaved={(updated) => {
            setWorkbook(updated);
            setDataError("");
          }}
        />
      ) : null}
      {pivotRange !== null ? (
        <CreatePivotTableDialog
          key={`${activeWorksheet.id}-${pivotRange}`}
          workbookId={workbook.id}
          sourceWorksheetId={activeWorksheet.id}
          range={pivotRange}
          onOpenChange={(open) => {
            if (!open) setPivotRange(null);
          }}
          onCreated={(updated) => {
            setWorkbook(updated);
            setPivotRange(null);
            setDataError("");
          }}
        />
      ) : null}
      {dataError && filterColumn === null && validationRange === null && sortRange === null && pivotRange === null ? (
        <p role="alert">{dataError}</p>
      ) : null}
      {structureError ? <p role="alert">{structureError}</p> : null}
      {history.error ? <p role="alert">{history.error}</p> : null}
      {worksheetError ? <p role="alert">{worksheetError}</p> : null}
      {notice ? <p role="alert">{notice}</p> : null}
      {renameTarget ? (
        <RenameWorksheetDialog
          key={renameTarget.id}
          workbookId={workbook.id}
          worksheet={renameTarget}
          onOpenChange={(open) => {
            if (!open) setRenameWorksheetId(null);
          }}
          onRenamed={(updated) => {
            setWorkbook(updated);
            setNotice("");
          }}
        />
      ) : null}
      {deleteTarget ? (
        <DeleteWorksheetDialog
          key={deleteTarget.id}
          workbookId={workbook.id}
          worksheet={deleteTarget}
          onOpenChange={(open) => {
            if (!open) setDeleteWorksheetId(null);
          }}
          onDeleted={(updated) => {
            setWorkbook(updated);
            setDeleteWorksheetId(null);
            setWorksheetError("");
          }}
          onError={(message) => setWorksheetError(message)}
        />
      ) : null}
      <RenameWorkbookDialog
        open={renameOpen}
        workbook={workbook}
        onOpenChange={setRenameOpen}
        onRenamed={(updated) => {
          setWorkbook(updated);
          setNotice("");
        }}
      />
    </main>
  );
}

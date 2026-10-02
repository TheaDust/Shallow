import { useCallback, useEffect, useRef, useState } from "react";

import { CreatePivotDialog } from "../components/CreatePivotDialog";
import { CreateWorkbookForm } from "../components/CreateWorkbookForm";
import { DataValidationDialog } from "../components/DataValidationDialog";
import { DeleteWorksheetDialog } from "../components/DeleteWorksheetDialog";
import { FilterDialog } from "../components/FilterDialog";
import { PasteDataDialog } from "../components/PasteDataDialog";
import { PivotTableEditor } from "../components/PivotTableEditor";
import { RenameWorkbookForm } from "../components/RenameWorkbookForm";
import { RenameWorksheetDialog } from "../components/RenameWorksheetDialog";
import { SortRangeDialog } from "../components/SortRangeDialog";
import { WorksheetGrid } from "../components/WorksheetGrid";
import { WorksheetTabs, tabId } from "../components/WorksheetTabs";
import { csvFileName, worksheetToCsv } from "../domain/csv";
import {
  dataRegionFor,
  distinctColumnValues,
  filterHeaderColumns,
  hiddenRows as hiddenRowsFor,
  parseRangeText,
  rangeText,
  withFilterRule,
} from "../domain/filter";
import { snapshotWorksheet } from "../domain/history";
import { regionHasHeaderRow, sortColumnOptions, type SortColumnOption, type SortRangeOptions } from "../domain/sort";
import { pivotHeaderOptions, pivotMissingFields } from "../domain/pivot";
import {
  activeWorksheet,
  cellName,
  formatLastUpdated,
  parseCellName,
  sameSelection,
  selectionFor,
  selectionRegion,
  storedSelection,
  workbookRoute,
  type CellRef,
  type ColumnStructureAction,
  type FilterRule,
  type PivotFields,
  type RowStructureAction,
  type Selection,
  type ValidationRule,
  type Workbook,
} from "../domain/workbook";
import {
  ruleForSelection,
  selectionRangeText,
  withValidationRule,
  withoutValidationRule,
} from "../domain/validation-rules";
import { ApiError, messageOf } from "../lib/api";
import { downloadCsv } from "../lib/csv-transfer";
import { replaceHash } from "../lib/hash-route";
import { addWorksheet, changeWorksheetStructure, configurePivotTable, createPivotTable, createWorkbook, deleteWorksheet, getWorkbook, refreshPivotTable, renameWorkbook, renameWorksheet, replaceWorksheetState, saveWorkbookState, saveWorksheetCells, saveWorksheetFilter, saveWorksheetValidations, sortWorksheetRange } from "../lib/workbook-api";
import { EditorToolbar } from "../components/EditorToolbar";
import { useRangeClipboard } from "./useRangeClipboard";
import { useWorkbookHistory } from "./useWorkbookHistory";
import { Button } from "../ui/Button";

const PANEL_ID = "worksheet-panel";

/** Displayed when the `Delete` command would leave the workbook without a tab. */
const LAST_WORKSHEET_MESSAGE = "A workbook must contain at least one worksheet";

export interface WorkbookEditorPageProps {
  workbookId: string;
  /**
   * Set when the editor page was entered from the creation page
   * (`#/workbooks/<id>?new=1&name=<name>`): the workbook is still to be created
   * and the editor performs that idempotent creation for `workbookId`.
   */
  pendingCreateName?: string | null;
}

type LoadState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "create-error"; message: string }
  | { status: "ready" };

/** Uncommitted cell text; `source` is the editor the user is typing in. */
interface CellDraft {
  name: string;
  text: string;
  source: "grid" | "formula";
}

function isNotFound(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 404;
  return /not found/i.test(messageOf(error, ""));
}

export function WorkbookEditorPage({ workbookId, pendingCreateName = null }: WorkbookEditorPageProps) {
  // Captured once per mounted workbook: a later URL cleanup must not turn a
  // pending creation into a plain fetch (or the other way around).
  const pendingName = useRef<string | null>(pendingCreateName);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [selection, setSelection] = useState<Selection>({ anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } });
  const [renaming, setRenaming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Uncommitted cell draft, shared by the formula bar and the inline grid box
  // (REQ-3-1-1). `source` decides where the draft is being typed so the two
  // editors never fight over focus.
  const [editing, setEditing] = useState<CellDraft | null>(null);
  // Mirror of `editing` for handlers that must see the draft synchronously
  // (blur right after a commit, or a click that commits the pending draft).
  const editRef = useRef<CellDraft | null>(null);
  const [adding, setAdding] = useState(false);
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  // "Delete worksheet" confirmation of one tab (REQ-2-1-4).
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [structureBusy, setStructureBusy] = useState(false);
  // Filter dialog of one column header (REQ-5-1-2) and the data validation
  // dialog of the current selection (REQ-5-2-1).
  const [filterTarget, setFilterTarget] = useState<{ header: string; col: number } | null>(null);
  const [filterBusy, setFilterBusy] = useState(false);
  // "Sort range" dialog of the current selection (REQ-5-1-1): the rectangle it
  // targets together with the options derived from its header row.
  const [sortTarget, setSortTarget] = useState<{ range: string; columns: SortColumnOption[]; defaultHasHeaderRow: boolean } | null>(null);
  const [sortBusy, setSortBusy] = useState(false);
  const [sortError, setSortError] = useState<string | null>(null);
  const [validationOpen, setValidationOpen] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationBusy, setValidationBusy] = useState(false);
  // "Create pivot table" dialog of the current selection (REQ-5-3-1) and the
  // state of the "Pivot table editor" of the active pivot-result worksheet.
  const [pivotTarget, setPivotTarget] = useState<{ worksheetId: string; range: string } | null>(null);
  const [pivotError, setPivotError] = useState<string | null>(null);
  const [pivotBusy, setPivotBusy] = useState(false);

  /** Applies a restored workbook: any open cell draft is dropped first. */
  const applyRestored = useCallback((updated: Workbook) => {
    editRef.current = null;
    setEditing(null);
    setWorkbook(updated);
    setNotice(null);
  }, []);

  // Undo/redo history of this workbook session (REQ-3-2-2). The component is
  // mounted per workbook id, so a history entry can never restore another
  // workbook, and the history is gone after reopening (the state it produced
  // stays persisted in the worksheet itself).
  const history = useWorkbookHistory({
    workbookId,
    hasOpenDraft: () => editRef.current !== null,
    restore: (worksheetId, snapshot) => replaceWorksheetState(workbookId, worksheetId, snapshot),
    onRestored: applyRestored,
    onError: (message) => setNotice(message),
  });

  /**
   * Stores one rectangle as the selection of one worksheet: the local view and
   * the persisted state travel together, and a failed save never disturbs the
   * workbook because the selection is only a view concern.
   */
  const persistSelectionState = useCallback((worksheetId: string, next: Selection) => {
    setWorkbook((current) => (current
      ? { ...current, selections: { ...(current.selections ?? {}), [worksheetId]: storedSelection(next) } }
      : current));
    void saveWorkbookState(workbookId, {
      selection: { worksheetId, ...storedSelection(next) },
    }).catch(() => {});
  }, [workbookId]);

  /**
   * Copy/cut/paste of the selected rectangle (REQ-3-1-2, REQ-3-2-1). The hook
   * owns the app clipboard and the labelled paste box; every write is one atomic
   * cell batch, so a rejected paste leaves the target and a cut source intact.
   * It runs before the load-state branches, so the hook order never changes.
   */
  const rangeClipboard = useRangeClipboard({
    workbookId,
    worksheet: workbook ? activeWorksheet(workbook) : null,
    selection,
    hasOpenDraft: () => editRef.current !== null,
    saveCells: (worksheetId, cells) => saveWorksheetCells(workbookId, worksheetId, cells),
    recordHistory: history.recordHistory,
    setWorkbook,
    setNotice,
    setSelection,
    persistSelection: persistSelectionState,
  });

  const showCreated = useCallback((created: Workbook) => {
    pendingName.current = null;
    setCreateError(null);
    setWorkbook(created);
    setSelection(selectionFor(created, activeWorksheet(created).id));
    setLoad({ status: "ready" });
    replaceHash(workbookRoute(created.id));
  }, []);

  const loadWorkbook = useCallback(async () => {
    setLoad({ status: "loading" });
    setCreateError(null);
    try {
      let loaded: Workbook;
      try {
        loaded = await getWorkbook(workbookId);
      } catch (error) {
        const name = pendingName.current;
        if (name === null || !isNotFound(error)) throw error;
        setCreating(true);
        try {
          loaded = await createWorkbook(workbookId, name);
        } finally {
          setCreating(false);
        }
      }
      showCreated(loaded);
    } catch (error) {
      setWorkbook(null);
      if (pendingName.current !== null) {
        setCreateError(messageOf(error, "Could not create the workbook."));
        setLoad({ status: "create-error", message: messageOf(error, "Could not create the workbook.") });
        return;
      }
      setLoad(/not found/i.test(messageOf(error, "")) ? { status: "missing" } : { status: "error", message: messageOf(error, "Could not load the workbook.") });
    }
  }, [workbookId, showCreated]);

  useEffect(() => {
    void loadWorkbook();
  }, [loadWorkbook]);

  const retryCreate = async (name: string) => {
    setCreating(true);
    setCreateError(null);
    replaceHash(workbookRoute(workbookId), new URLSearchParams({ new: "1", name }));
    try {
      const created = await createWorkbook(workbookId, name);
      showCreated(created);
    } catch (error) {
      pendingName.current = name;
      setCreateError(messageOf(error, "Could not create the workbook."));
      setLoad({ status: "create-error", message: messageOf(error, "Could not create the workbook.") });
    } finally {
      setCreating(false);
    }
  };

  if (load.status === "create-error") {
    return (
      <CreateWorkbookForm
        initialName={pendingName.current ?? ""}
        error={createError ?? load.message}
        busy={creating}
        onCreate={(name) => { void retryCreate(name); }}
      />
    );
  }

  if (load.status === "loading") {
    return (
      <main className="editor">
        <p role="status">{pendingName.current === null ? "Loading workbook…" : "Creating workbook…"}</p>
      </main>
    );
  }
  const activeId = workbook ? activeWorksheet(workbook).id : "";

  if (load.status === "missing" || load.status === "error") {
    return (
      <main className="editor">
        <h1>{load.status === "missing" ? "Workbook not found" : "Workbook unavailable"}</h1>
        <p role="alert">
          {load.status === "missing"
            ? "This workbook does not exist."
            : load.message}
        </p>
        <p><a href="#/">Back to workbooks</a></p>
        {load.status === "error" ? <Button onClick={() => void loadWorkbook()}>Retry</Button> : null}
      </main>
    );
  }

  if (!workbook) {
    return (
      <main className="editor">
        <p role="status">Loading workbook…</p>
      </main>
    );
  }

  const worksheet = activeWorksheet(workbook);
  const focusName = cellName(selection.focus);
  const storedText = worksheet.cells[focusName] ?? "";
  // The formula bar shows the original submitted text of the selected cell, or
  // the uncommitted draft while that same cell is being edited.
  const barValue = editing && editing.name === focusName ? editing.text : storedText;
  // The grid only renders the inline box while the draft is typed in the grid;
  // a formula-bar draft keeps the cell content visible.
  const gridEditing = editing && editing.source === "grid" ? editing : null;
  // Derived filter view (REQ-5-1-2): the hidden rows are recomputed from the
  // stored cells and the persisted rules, so the same rows are hidden after a
  // refresh, and the dialog of one column offers the distinct displayed values
  // of that column inside the filtered region. Plain values (not hooks) because
  // this code runs after the early loading/missing returns.
  const filterRegion = worksheet.filter ? parseRangeText(worksheet.filter.range) : null;
  const filterCols = worksheet.filter ? filterHeaderColumns(worksheet, worksheet.filter) : [];
  const hiddenRows = hiddenRowsFor(worksheet, worksheet.filter);
  const filterValues = filterTarget && filterRegion
    ? distinctColumnValues(worksheet, filterRegion, filterTarget.col)
    : [];
  // Pivot state of the active worksheet (REQ-5-3-1): the source headers feed the
  // editor combos, and a configured field the source no longer provides is
  // reported so the user can replace it without losing the last summary.
  const pivot = worksheet.pivot;
  const pivotSource = pivot
    ? workbook.worksheets.find((candidate) => candidate.id === pivot.sourceWorksheetId)
    : undefined;
  const pivotHeaders = pivot ? pivotHeaderOptions(pivotSource, pivot.sourceRange) : [];
  const pivotAlert = pivotError
    ?? (pivot && pivotMissingFields(pivot, pivotHeaders).length
      ? "Pivot field is no longer available. Select a new field."
      : null);

  const recordHistory = history.recordHistory;

  /**
   * Saves one cell (REQ-3-1-1). The server response is authoritative, so the
   * grid and formula bar show the stored value again; a failure reports the
   * error and leaves the last successful value and every dependent result in
   * place because nothing was applied locally.
   */
  const saveCellText = async (name: string, text: string) => {
    const before = snapshotWorksheet(worksheet);
    try {
      const updated = await saveWorksheetCells(workbookId, worksheet.id, { [name]: text });
      recordHistory("cell edit", worksheet.id, before, updated);
      setWorkbook(updated);
      setNotice(null);
    } catch (error) {
      setNotice(messageOf(error, "Could not save the cell value."));
    }
  };

  const startEdit = (ref: CellRef, initialText?: string) => {
    const name = cellName(ref);
    const draft: CellDraft = { name, text: initialText ?? (worksheet.cells[name] ?? ""), source: "grid" };
    editRef.current = draft;
    setEditing(draft);
  };

  const changeEdit = (text: string) => {
    const current = editRef.current;
    if (!current) return;
    const draft: CellDraft = { ...current, text };
    editRef.current = draft;
    setEditing(draft);
  };

  /** Formula bar input: starts or updates the draft of the selected cell. */
  const changeCellText = (name: string, text: string) => {
    const current = editRef.current;
    if (current && current.name === name) {
      changeEdit(text);
      return;
    }
    const ref = parseCellName(name);
    if (!ref) return;
    const draft: CellDraft = { name, text, source: "formula" };
    editRef.current = draft;
    setEditing(draft);
  };

  /** Escape / a worksheet switch drops the draft; the stored value stays. */
  const cancelEdit = () => {
    editRef.current = null;
    setEditing(null);
  };

  /** Enter, blur or clicking another cell commits the pending draft. */
  const commitEdit = () => {
    const current = editRef.current;
    if (!current) return;
    editRef.current = null;
    setEditing(null);
    if (current.text === (worksheet.cells[current.name] ?? "")) return;
    void saveCellText(current.name, current.text);
  };

  const clearCell = (ref: CellRef) => {
    const name = cellName(ref);
    if ((worksheet.cells[name] ?? "") === "") return;
    void saveCellText(name, "");
  };

  const selectWorksheet = (worksheetId: string) => {
    if (worksheetId === workbook.activeWorksheetId) return;
    // A pending draft belongs to the worksheet being left; commit it there.
    commitEdit();
    // An open filter/validation/sort dialog targets the worksheet being left.
    setFilterTarget(null);
    setValidationOpen(false);
    setSortTarget(null);
    setPivotTarget(null);
    setPivotError(null);
    setWorkbook((current) => (current ? { ...current, activeWorksheetId: worksheetId } : current));
    setSelection(selectionFor(workbook, worksheetId));
    void saveWorkbookState(workbookId, { activeWorksheetId: worksheetId }).catch((error) => {
      setNotice(messageOf(error, "Could not switch worksheets."));
    });
  };

  /**
   * Selection handling (REQ-3-1-3). `selectCells` only updates the visible
   * rectangle; `commitSelection` persists the complete rectangle once per
   * gesture so a click, a drag or a keyboard move survives a refresh without a
   * request per pointer move. Switching worksheets never writes the selection
   * of another worksheet.
   */
  const selectCells = (next: Selection) => {
    if (editRef.current && editRef.current.name !== cellName(next.focus)) commitEdit();
    setSelection(next);
  };

  /** Stores one rectangle as this worksheet's selection without re-checking it. */
  const persistSelection = (next: Selection) => persistSelectionState(worksheet.id, next);

  const commitSelection = (next: Selection) => {
    if (sameSelection(selectionFor(workbook, worksheet.id), next)) return;
    persistSelection(next);
  };

  const applyRename = async (name: string) => {
    const updated = await renameWorkbook(workbookId, name);
    setWorkbook(updated);
    setRenaming(false);
  };

  /**
   * Adds a blank worksheet (REQ-2-1-1). The updated workbook from the server is
   * authoritative: it carries the new tab, its active state and the A1 selection.
   * On failure no tab is added and the error is reported in the editor.
   */
  const handleAddWorksheet = async () => {
    if (adding) return;
    setAdding(true);
    setNotice(null);
    try {
      const updated = await addWorksheet(workbookId);
      setWorkbook(updated);
      setSelection(selectionFor(updated, activeWorksheet(updated).id));
    } catch (error) {
      setNotice(messageOf(error, "Could not add a worksheet."));
    } finally {
      setAdding(false);
    }
  };

  /** Saves a new worksheet name (REQ-2-1-3); failures keep the dialog open. */
  const handleRenameWorksheet = async (name: string) => {
    const targetId = renameTargetId;
    if (!targetId || renameBusy) return;
    setRenameBusy(true);
    setRenameError(null);
    try {
      const updated = await renameWorksheet(workbookId, targetId, name);
      setWorkbook(updated);
      setRenameTargetId(null);
      setNotice(null);
    } catch (error) {
      setRenameError(messageOf(error, "Could not rename the worksheet."));
    } finally {
      setRenameBusy(false);
    }
  };

  /**
   * "Delete" of a worksheet tab (REQ-2-1-4). When the `Delete` command would
   * remove the last worksheet no confirmation opens at all: the rule is
   * reported straight away in the editor and the tab stays. Otherwise the
   * confirmation dialog is opened on the target tab.
   */
  const openDeleteWorksheet = (worksheetId: string) => {
    if (workbook.worksheets.length <= 1) {
      setNotice(LAST_WORKSHEET_MESSAGE);
      return;
    }
    setNotice(null);
    setDeleteTargetId(worksheetId);
  };

  /** Closes every dialog that targeted the removed worksheet. */
  const closeTargetedDialogs = (worksheetId: string) => {
    setFilterTarget(null);
    setValidationOpen(false);
    setValidationError(null);
    setSortTarget(null);
    setPivotTarget(null);
    setPivotError(null);
    if (renameTargetId === worksheetId) {
      setRenameTargetId(null);
      setRenameError(null);
    }
  };

  /**
   * Confirms the deletion. The server is the authority: it refuses the last
   * worksheet and a worksheet a pivot table still reads, so a rejection leaves
   * the target tab, its grid and every pivot result untouched. Either way the
   * confirmation closes and a failure stays visible in the editor, which keeps
   * the tab bar operable after the attempt.
   */
  const confirmDeleteWorksheet = async () => {
    const targetId = deleteTargetId;
    if (!targetId || deleteBusy) return;
    setDeleteBusy(true);
    const wasActive = targetId === worksheet.id;
    try {
      const updated = await deleteWorksheet(workbookId, targetId);
      // A draft of the removed worksheet has no home left; any other draft stays.
      if (wasActive) cancelEdit();
      // Its recorded undo steps would target a worksheet that no longer exists.
      history.dropWorksheet(targetId);
      closeTargetedDialogs(targetId);
      setWorkbook(updated);
      if (wasActive) setSelection(selectionFor(updated, activeWorksheet(updated).id));
      setDeleteTargetId(null);
      setNotice(null);
    } catch (error) {
      closeTargetedDialogs(targetId);
      setDeleteTargetId(null);
      setNotice(messageOf(error, "Could not delete the worksheet."));
    } finally {
      setDeleteBusy(false);
    }
  };

  // Export only reads the active worksheet; it must not change any view state.
  // Hidden rows stay included because the export reads the stored cells, not the
  // filtered view (REQ-5-1-2).
  const exportActiveWorksheet = () => {
    downloadCsv(csvFileName(workbook.name), worksheetToCsv(worksheet));
  };

  /**
   * "Create filter" (REQ-5-1-2): stores a filter over the selected rectangle —
   * or over the used data region around a single selected cell — with no column
   * rule yet, so every header of the region gets its `Filter <header>` button.
   */
  const createFilter = async () => {
    const region = dataRegionFor(worksheet, selection);
    const text = region ? rangeText(region) : "";
    if (!region || !parseRangeText(text)) {
      setNotice("Select a range with a header row before creating a filter.");
      return;
    }
    try {
      const updated = await saveWorksheetFilter(workbookId, worksheet.id, { range: text, rules: [] });
      setWorkbook(updated);
      setNotice(null);
    } catch (error) {
      setNotice(messageOf(error, "Could not create the filter."));
    }
  };

  /**
   * Applies the dialog result of one column: the rule replaces the previous rule
   * of that header (`null` removes the constraint). Only the persisted rules
   * change — no cell is ever rewritten, so the source records and their order
   * stay intact and "Clear filter" can show them all again.
   */
  const applyFilterRule = async (rule: FilterRule | null) => {
    const current = worksheet.filter;
    if (!current || !filterTarget || filterBusy) return;
    setFilterBusy(true);
    try {
      const updated = await saveWorksheetFilter(
        workbookId,
        worksheet.id,
        withFilterRule(current, rule, filterTarget.header),
      );
      setWorkbook(updated);
      setFilterTarget(null);
      setNotice(null);
    } catch (error) {
      setNotice(messageOf(error, "Could not apply the filter."));
    } finally {
      setFilterBusy(false);
    }
  };

  /** "Clear filter": all source records become visible again in their own order. */
  const clearFilter = async () => {
    if (!worksheet.filter) return;
    try {
      const updated = await saveWorksheetFilter(workbookId, worksheet.id, null);
      setWorkbook(updated);
      setFilterTarget(null);
      setNotice(null);
    } catch (error) {
      setNotice(messageOf(error, "Could not clear the filter."));
    }
  };

  /**
   * "Create pivot table" (REQ-5-3-1): opens the dialog on the selected source
   * range — or on the used data region around a single selected cell — so the
   * user confirms the range before the PivotN worksheet is created.
   */
  const openCreatePivot = () => {
    const region = dataRegionFor(worksheet, selection);
    if (!region) {
      setNotice("Select a range with headers before creating a pivot table.");
      return;
    }
    setPivotError(null);
    setPivotTarget({ worksheetId: worksheet.id, range: rangeText(region) });
  };

  /**
   * Creates the pivot-result worksheet. The server picks the first unused
   * `PivotN` name, makes it active and answers with the authoritative workbook,
   * so the new tab and its (still unconfigured) pivot appear immediately.
   */
  const createPivot = async () => {
    if (!pivotTarget || pivotBusy) return;
    setPivotBusy(true);
    setPivotError(null);
    try {
      const updated = await createPivotTable(workbookId, {
        sourceWorksheetId: pivotTarget.worksheetId,
        range: pivotTarget.range,
      });
      setWorkbook(updated);
      setSelection(selectionFor(updated, activeWorksheet(updated).id));
      setPivotTarget(null);
    } catch (error) {
      setPivotError(messageOf(error, "Could not create the pivot table."));
    } finally {
      setPivotBusy(false);
    }
  };

  /**
   * "Apply" of the pivot editor: the server validates the chosen fields against
   * the current source headers, stores the configuration and replaces the whole
   * summary. A rejected field keeps the last successful result (no write), and
   * the error stays beside the editor controls.
   */
  const applyPivotFields = async (fields: PivotFields) => {
    if (pivotBusy) return;
    if (!fields.rowField || !fields.valueField) {
      setPivotError("Select a row field and a value field.");
      return;
    }
    setPivotBusy(true);
    setPivotError(null);
    try {
      setWorkbook(await configurePivotTable(workbookId, worksheet.id, fields));
    } catch (error) {
      setPivotError(messageOf(error, "Could not apply the pivot configuration."));
    } finally {
      setPivotBusy(false);
    }
  };

  /**
   * "Refresh pivot table": recomputes the stored configuration from the current
   * source content. A deleted source header (or unusable range) is reported and
   * the previous summary plus both worksheets stay unchanged.
   */
  const refreshPivot = async () => {
    if (pivotBusy) return;
    setPivotBusy(true);
    setPivotError(null);
    try {
      setWorkbook(await refreshPivotTable(workbookId, worksheet.id));
    } catch (error) {
      setPivotError(messageOf(error, "Could not refresh the pivot table."));
    } finally {
      setPivotBusy(false);
    }
  };

  /**
   * "Sort range" (REQ-5-1-1): opens the dialog on the selected rectangle — or
   * on the used data region around a single selected cell — with one `Sort by`
   * option per column of that rectangle, named after its header text.
   */
  const openSortRange = () => {
    const region = dataRegionFor(worksheet, selection);
    if (!region) {
      setNotice("Select a range with data before sorting.");
      return;
    }
    setSortError(null);
    setSortTarget({
      range: rangeText(region),
      columns: sortColumnOptions(worksheet, region),
      defaultHasHeaderRow: regionHasHeaderRow(worksheet, region),
    });
  };

  /**
   * Applies one sort request. The server permutes the rows of the rectangle and
   * answers with the authoritative workbook; a rejected sort shows the error
   * in the dialog and leaves the grid in its original order.
   */
  const applySortRange = async (request: SortRangeOptions) => {
    if (!sortTarget || sortBusy) return;
    setSortBusy(true);
    setSortError(null);
    const before = snapshotWorksheet(worksheet);
    try {
      const updated = await sortWorksheetRange(workbookId, worksheet.id, {
        range: sortTarget.range,
        column: request.column,
        order: request.order,
        hasHeaderRow: request.hasHeaderRow,
      });
      recordHistory("sort range", worksheet.id, before, updated);
      setWorkbook(updated);
      setSortTarget(null);
      setNotice(null);
    } catch (error) {
      setSortError(messageOf(error, "Could not sort the range."));
    } finally {
      setSortBusy(false);
    }
  };

  /** Rule covering the current selection, when the dialog reopens on one. */
  const validationRule = ruleForSelection(worksheet.validations, selection);

  /**
   * Saves the validation rule of the current selection (REQ-5-2-1). The whole
   * rule list is sent at once, with the overlapping rules replaced by the new
   * one, so the new range is effective immediately and existing values are
   * untouched (only later writes are checked). A failure keeps the dialog open
   * with the error beside the control.
   */
  const saveValidation = async (rule: ValidationRule) => {
    if (validationBusy) return;
    setValidationBusy(true);
    setValidationError(null);
    try {
      const updated = await saveWorksheetValidations(
        workbookId,
        worksheet.id,
        withValidationRule(worksheet.validations, rule, rule.range),
      );
      setWorkbook(updated);
      setValidationOpen(false);
      setNotice(null);
    } catch (error) {
      setValidationError(messageOf(error, "Could not save the validation rule."));
    } finally {
      setValidationBusy(false);
    }
  };

  /** "Delete rule": removes the constraint the dialog was opened on. */
  const deleteValidation = async () => {
    if (validationBusy) return;
    setValidationBusy(true);
    setValidationError(null);
    try {
      const updated = await saveWorksheetValidations(
        workbookId,
        worksheet.id,
        withoutValidationRule(worksheet.validations, validationRule),
      );
      setWorkbook(updated);
      setValidationOpen(false);
      setNotice(null);
    } catch (error) {
      setValidationError(messageOf(error, "Could not delete the validation rule."));
    } finally {
      setValidationBusy(false);
    }
  };

  /**
   * Writes the value chosen in a dropdown list (REQ-5-2-1) as one cell commit;
   * the server checks the rule, so an option can never bypass validation.
   */
  const chooseDropdownValue = async (ref: CellRef, value: string) => {
    const name = cellName(ref);
    const before = snapshotWorksheet(worksheet);
    try {
      const updated = await saveWorksheetCells(workbookId, worksheet.id, { [name]: value });
      recordHistory("cell edit", worksheet.id, before, updated);
      setWorkbook(updated);
      setNotice(null);
    } catch (error) {
      setNotice(messageOf(error, "Could not save the cell value."));
    }
  };

  /**
   * Row/column structure change from a header menu (REQ-2-2). The server response
   * is the authoritative workbook, so the grid shows the moved values and adjusted
   * formulas; a failure leaves the grid exactly as it was and reports the error.
   */
  const applyStructure = async (
    axis: "row" | "column",
    action: RowStructureAction | ColumnStructureAction,
    index: number,
  ) => {
    if (structureBusy) return;
    setStructureBusy(true);
    setNotice(null);
    const before = snapshotWorksheet(worksheet);
    try {
      const updated = await changeWorksheetStructure(workbookId, worksheet.id, axis, action, index);
      recordHistory(`${action} ${axis}`, worksheet.id, before, updated);
      setWorkbook(updated);
      cancelEdit();
    } catch (error) {
      setNotice(messageOf(error, "Could not change the row and column structure."));
    } finally {
      setStructureBusy(false);
    }
  };

  return (
    <main className="editor">
      <header className="editor__header">
        <p className="editor__home"><a href="#/">Workbooks</a></p>
        <div className="editor__title">
          <h1>{workbook.name}</h1>
          {renaming ? (
            <RenameWorkbookForm
              initialName={workbook.name}
              onSubmit={applyRename}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <Button aria-label="Rename workbook" onClick={() => setRenaming(true)}>Rename workbook</Button>
          )}
        </div>
        <p className="editor__updated">Last updated: {formatLastUpdated(workbook.updatedAt)}</p>
      </header>

      <EditorToolbar
        canUndo={history.undoStack.length > 0}
        canRedo={history.redoStack.length > 0}
        onUndo={history.undo}
        onRedo={history.redo}
        onCopy={() => rangeClipboard.copyToSystem("copy")}
        onCut={() => rangeClipboard.copyToSystem("cut")}
        onPaste={rangeClipboard.pasteFromControl}
        onExport={exportActiveWorksheet}
        hasFilter={Boolean(worksheet.filter)}
        onCreateFilter={() => { void createFilter(); }}
        onSortRange={openSortRange}
        onCreatePivot={openCreatePivot}
        onDataValidation={() => {
          setValidationError(null);
          setValidationOpen(true);
        }}
        onClearFilter={() => { void clearFilter(); }}
      />

      <WorksheetTabs
        worksheets={workbook.worksheets}
        activeId={worksheet.id}
        panelId={PANEL_ID}
        onSelect={selectWorksheet}
        onRename={(worksheetId) => {
          setRenameError(null);
          setRenameTargetId(worksheetId);
        }}
        onDelete={openDeleteWorksheet}
        onAdd={() => { void handleAddWorksheet(); }}
        adding={adding}
      />

      {renameTargetId ? (
        <RenameWorksheetDialog
          initialName={workbook.worksheets.find((candidate) => candidate.id === renameTargetId)?.name ?? ""}
          error={renameError}
          busy={renameBusy}
          onSubmit={(name) => { void handleRenameWorksheet(name); }}
          onOpenChange={(open) => {
            if (!open) {
              setRenameTargetId(null);
              setRenameError(null);
            }
          }}
        />
      ) : null}

      {deleteTargetId ? (
        <DeleteWorksheetDialog
          worksheetName={workbook.worksheets.find((candidate) => candidate.id === deleteTargetId)?.name ?? ""}
          busy={deleteBusy}
          onConfirm={() => { void confirmDeleteWorksheet(); }}
          onOpenChange={(open) => {
            if (!open) setDeleteTargetId(null);
          }}
        />
      ) : null}

      <div className="formula-bar">
        <label htmlFor="formula-bar-input">Formula bar</label>
        <input
          id="formula-bar-input"
          type="text"
          autoComplete="off"
          value={barValue}
          onChange={(event) => changeCellText(focusName, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitEdit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancelEdit();
            }
          }}
          onBlur={() => commitEdit()}
        />
      </div>

      {notice ? <p role="alert" className="editor__notice">{notice}</p> : null}

      {pivot ? (
        <PivotTableEditor
          key={worksheet.id}
          headers={pivotHeaders}
          pivot={pivot}
          busy={pivotBusy}
          error={pivotAlert}
          onApply={(fields) => { void applyPivotFields(fields); }}
          onRefresh={() => { void refreshPivot(); }}
        />
      ) : null}

      <div id={PANEL_ID} role="tabpanel" aria-labelledby={tabId(worksheet.id)} className="worksheet-panel">
        <WorksheetGrid
          worksheet={worksheet}
          selection={selection}
          editing={gridEditing}
          onSelect={selectCells}
          onSelectCommit={commitSelection}
          onEditStart={startEdit}
          onEditChange={changeEdit}
          onEditCommit={commitEdit}
          onEditCancel={cancelEdit}
          onClearCell={clearCell}
          onPasteText={(text) => rangeClipboard.pasteEvent(text)}
          onPasteFromClipboard={rangeClipboard.pasteFromControl}
          onCopyRange={(mode) => rangeClipboard.captureSelection(mode)}
          onRowAction={(action, index) => { void applyStructure("row", action, index); }}
          onColumnAction={(action, index) => { void applyStructure("column", action, index); }}
          filter={worksheet.filter}
          hiddenRows={hiddenRows}
          onFilterOpen={(header) => {
            const col = filterCols.find((entry) => entry.header === header)?.col ?? 0;
            setFilterTarget({ header, col });
          }}
          validations={worksheet.validations}
          onDropdownSelect={(ref, value) => { void chooseDropdownValue(ref, value); }}
        />
      </div>

      {filterTarget ? (
        <FilterDialog
          key={`${worksheet.id}-${filterTarget.header}`}
          header={filterTarget.header}
          values={filterValues}
          rule={worksheet.filter?.rules.find((rule) => rule.header === filterTarget.header) ?? null}
          busy={filterBusy}
          onApply={(rule) => { void applyFilterRule(rule); }}
          onOpenChange={(open) => {
            if (!open) setFilterTarget(null);
          }}
        />
      ) : null}

      {validationOpen ? (
        <DataValidationDialog
          target={selectionRangeText(selection)}
          existing={validationRule}
          error={validationError}
          busy={validationBusy}
          onSubmit={(rule) => { void saveValidation(rule); }}
          onDelete={() => { void deleteValidation(); }}
          onOpenChange={(open) => {
            if (!open) {
              setValidationOpen(false);
              setValidationError(null);
            }
          }}
        />
      ) : null}

      {sortTarget ? (
        <SortRangeDialog
          key={`${worksheet.id}-${sortTarget.range}`}
          target={sortTarget.range}
          columns={sortTarget.columns}
          defaultHasHeaderRow={sortTarget.defaultHasHeaderRow}
          error={sortError}
          busy={sortBusy}
          onSubmit={(request) => { void applySortRange(request); }}
          onOpenChange={(open) => {
            if (!open) {
              setSortTarget(null);
              setSortError(null);
            }
          }}
        />
      ) : null}

      <PasteDataDialog
        open={rangeClipboard.pasteOpen}
        initialText={rangeClipboard.pasteText}
        onOpenChange={rangeClipboard.setPasteOpen}
        onPaste={rangeClipboard.pasteTextIntoGrid}
      />

      {pivotTarget ? (
        <CreatePivotDialog
          sourceRange={pivotTarget.range}
          busy={pivotBusy}
          error={pivotError}
          onCreate={() => { void createPivot(); }}
          onOpenChange={(open) => {
            if (!open) {
              setPivotTarget(null);
              setPivotError(null);
            }
          }}
        />
      ) : null}
    </main>
  );
}

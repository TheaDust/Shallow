/**
 * Data-organization commands of the editor (REQ-5): the `Data` menu, the filter dialog and the
 * data-validation dialog of the current active worksheet.
 *
 * The hook owns the dialog state and the in-flight guard, but the workbook stays owned by the
 * editor page: every successful command is handed back through `applyWorkbook`, and a refused
 * command only reports its message, so the grid, the filter and the rules keep the last
 * successful state.
 */

import { useRef, useState } from "react";

import {
  createPivotTable as requestPivotTable,
  refreshPivotTable,
  savePivotConfig,
  saveWorksheetFilter,
  saveWorksheetValidations,
  sortWorksheetRange,
} from "../api/workbooks";
import type { FilterDraft } from "../components/FilterDialog";
import type { PivotDraft } from "../components/PivotTableEditor";
import type { SortDraft } from "../components/SortRangeDialog";
import type { ValidationDraft } from "../components/DataValidationDialog";
import {
  columnFilterOf,
  distinctColumnValues,
  filterHeaderText,
  filterRangeOf,
} from "../domain/filter";
import { looksLikeHeaderRow, sortColumnOptions, type SortColumnOption } from "../domain/sort";
import type { CellSelection } from "../domain/spreadsheet";
import { ruleForSelection, selectionRangeText } from "../domain/validation";
import type {
  ColumnFilter,
  ValidationRule,
  WorkbookState,
  WorksheetFilter,
  WorksheetState,
} from "../domain/workbook";

export interface DataToolsOptions {
  workbookId: string;
  sheet: WorksheetState | undefined;
  selection: CellSelection;
  /** Replaces the visible workbook after a successful command. */
  applyWorkbook(workbook: WorkbookState): void;
  /** Writes one cell through the ordinary commit path; returns the failure message or null. */
  writeCell(address: string, value: string): Promise<string | null>;
  /** True while another editor command is in flight. */
  commandBusy?: boolean;
  /** Follows the pivot-result worksheet a successful create activated. */
  openWorksheet?(sheetId: string): void;
}

export interface DataTools {
  /** True while one of these commands is in flight. */
  busy: boolean;
  /** Page-level failure of a mismatching command (for example "nothing to filter"). */
  error: string;
  /** `Sort range` dialog of the active worksheet (REQ-5-1-1). */
  sortOpen: boolean;
  /** Failure of the sort request, shown inside the dialog. */
  sortError: string;
  /** Columns of the selected rectangle, each named after its header text. */
  sortColumns: SortColumnOption[];
  /** Starting state of `Data has header row` for the selected rectangle. */
  sortHasHeader: boolean;
  filterColumn: string | null;
  filterHeader: string;
  filterValues: string[];
  currentColumnFilter: ColumnFilter | undefined;
  filterError: string;
  validationOpen: boolean;
  validationError: string;
  /** Rule stored for exactly the selected rectangle, if any. */
  activeRule: ValidationRule | null;
  selectedRange: string;
  openSort(): void;
  closeSort(): void;
  applySort(draft: SortDraft): void;
  createFilter(): void;
  clearFilter(): void;
  openFilter(column: string): void;
  closeFilter(): void;
  applyFilter(draft: FilterDraft): void;
  openValidation(): void;
  closeValidation(): void;
  /** Writes the value chosen in a dropdown cell. */
  setCellValue(address: string, value: string): void;
  saveValidation(draft: ValidationDraft): void;
  deleteValidation(): void;
  /** `Create pivot table` dialog of the active worksheet (REQ-5-3-1). */
  pivotOpen: boolean;
  /** Failure of the create request, shown inside the dialog. */
  pivotError: string;
  /** Failure of `Apply` or `Refresh pivot table`, shown in the pivot table editor region. */
  pivotEditorError: string;
  openPivotTable(): void;
  closePivotTable(): void;
  createPivotTable(): void;
  applyPivot(draft: PivotDraft): void;
  refreshPivot(): void;
}

export function useDataTools({
  workbookId,
  sheet,
  selection,
  applyWorkbook,
  writeCell,
  commandBusy = false,
  openWorksheet,
}: DataToolsOptions): DataTools {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const [sortError, setSortError] = useState("");
  const [filterColumn, setFilterColumn] = useState<string | null>(null);
  const [filterError, setFilterError] = useState("");
  const [validationOpen, setValidationOpen] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [pivotOpen, setPivotOpen] = useState(false);
  const [pivotError, setPivotError] = useState("");
  const [pivotEditorError, setPivotEditorError] = useState("");
  const busyRef = useRef(false);
  /**
   * Runs one command against the server. The workbook is only replaced by a successful
   * response, so a refused command leaves every visible state as it was.
   * @returns the failure message, or null when the command succeeded.
   */
  async function run(request: () => Promise<{ workbook: WorkbookState }>): Promise<string | null> {
    setBusy(true);
    setError("");
    try {
      const result = await request();
      applyWorkbook(result.workbook);
      return null;
    } catch (failure) {
      return failure instanceof Error ? failure.message : "Unable to apply the change";
    } finally {
      setBusy(false);
    }
  }

  const selectedRange = selectionRangeText(selection);
  const activeRule = sheet ? (ruleForSelection(sheet.validations, selection) ?? null) : null;
  const filter = sheet?.filter;

  return {
    busy,
    error,
    sortOpen,
    sortError,
    sortColumns: sheet ? sortColumnOptions(sheet, selection) : [],
    sortHasHeader: sheet ? looksLikeHeaderRow(sheet, selection) : false,
    filterColumn,
    filterError,
    validationOpen,
    validationError,
    activeRule,
    selectedRange,
    filterHeader:
      sheet && filterColumn ? filterHeaderText(sheet, filter, filterColumn) : "",
    filterValues: sheet && filterColumn ? distinctColumnValues(sheet, filter, filterColumn) : [],
    currentColumnFilter: filterColumn ? columnFilterOf(filter, filterColumn) : undefined,

    /** `Sort range` acts on exactly the selected rectangle of the active worksheet. */
    openSort() {
      setSortError("");
      setError("");
      setSortOpen(true);
    },

    closeSort() {
      setSortOpen(false);
    },

    applySort(draft) {
      if (!sheet) return;
      void run(() =>
        sortWorksheetRange(workbookId, sheet.id, {
          range: selectedRange,
          column: draft.column,
          order: draft.order,
          hasHeader: draft.hasHeader,
        }),
      ).then((failure) => {
        // A refused sort keeps the dialog open with its message; the grid is untouched.
        if (failure) setSortError(failure);
        else setSortOpen(false);
      });
    },

    /** `Create filter` covers the data region of the active worksheet (header row included). */
    createFilter() {
      if (!sheet) return;
      const range = filterRangeOf(sheet);
      if (!range) {
        setError("There is nothing to filter in this worksheet");
        return;
      }
      void run(() =>
        saveWorksheetFilter(workbookId, sheet.id, { range, columns: sheet.filter?.columns ?? [] }),
      ).then((failure) => {
        if (failure) setError(failure);
      });
    },

    clearFilter() {
      if (!sheet) return;
      setFilterColumn(null);
      void run(() => saveWorksheetFilter(workbookId, sheet.id, null)).then((failure) => {
        if (failure) setError(failure);
      });
    },

    openFilter(column) {
      setFilterError("");
      setError("");
      setFilterColumn(column);
    },

    closeFilter() {
      setFilterColumn(null);
    },

    /** Applies one column of the filter: values, a condition, or no constraint at all. */
    applyFilter(draft) {
      if (!sheet || !filter || !filterColumn) return;
      const others = filter.columns.filter((entry) => entry.column !== filterColumn);
      const totalValues = distinctColumnValues(sheet, filter, filterColumn).length;
      // Checking every value of a column means "no constraint", exactly like Sheets.
      const keepsEverything = draft.mode === "values" && draft.values.length === totalValues;
      const next: WorksheetFilter = {
        range: filter.range,
        columns: keepsEverything
          ? others
          : [
              ...others,
              draft.mode === "values"
                ? { column: filterColumn, mode: "values", values: draft.values }
                : {
                    column: filterColumn,
                    mode: "condition",
                    condition: draft.condition,
                    value: draft.value,
                  },
            ],
      };
      void run(() => saveWorksheetFilter(workbookId, sheet.id, next)).then((failure) => {
        if (failure) setFilterError(failure);
        else setFilterColumn(null);
      });
    },

    openValidation() {
      setValidationError("");
      setError("");
      setValidationOpen(true);
    },

    closeValidation() {
      setValidationOpen(false);
    },

    /** A dropdown cell commits the chosen allowed value through the ordinary cell write. */
    setCellValue(address, value) {
      if (busyRef.current || commandBusy) return;
      busyRef.current = true;
      setBusy(true);
      setError("");
      void writeCell(address, value)
        .then((failure) => {
          if (failure) setError(failure);
        })
        .finally(() => {
          busyRef.current = false;
          setBusy(false);
        });
    },

    saveValidation(draft) {
      if (!sheet) return;
      const id = activeRule?.id ?? crypto.randomUUID();
      const rule: ValidationRule =
        draft.type === "dropdown"
          ? { id, range: selectedRange, type: "dropdown", values: draft.values ?? [] }
          : {
              id,
              range: selectedRange,
              type: "number-range",
              min: draft.min ?? 0,
              max: draft.max ?? 0,
            };
      const validations = [...(sheet.validations ?? []).filter((entry) => entry.id !== id), rule];
      void run(() => saveWorksheetValidations(workbookId, sheet.id, validations)).then(
        (failure) => {
          if (failure) setValidationError(failure);
          else setValidationOpen(false);
        },
      );
    },

    deleteValidation() {
      if (!sheet || !activeRule) return;
      const validations = (sheet.validations ?? []).filter((entry) => entry.id !== activeRule.id);
      void run(() => saveWorksheetValidations(workbookId, sheet.id, validations)).then(
        (failure) => {
          if (failure) setValidationError(failure);
          else setValidationOpen(false);
        },
      );
    },

    pivotOpen,
    pivotError,
    pivotEditorError,

    openPivotTable() {
      setPivotError("");
      setError("");
      setPivotOpen(true);
    },

    closePivotTable() {
      setPivotOpen(false);
    },

    /** Creates the pivot-result worksheet of the selected source range and follows it. */
    createPivotTable() {
      if (!sheet || busyRef.current || commandBusy) return;
      busyRef.current = true;
      setBusy(true);
      setPivotError("");
      void requestPivotTable(workbookId, sheet.id, selectedRange)
        .then((result) => {
          applyWorkbook(result.workbook);
          openWorksheet?.(result.worksheet.id);
          setPivotEditorError("");
          setPivotOpen(false);
        })
        .catch((failure: unknown) => {
          setPivotError(
            failure instanceof Error ? failure.message : "Unable to create the pivot table",
          );
        })
        .finally(() => {
          busyRef.current = false;
          setBusy(false);
        });
    },

    /** Stores the chosen fields and their recomputed summary on the pivot worksheet. */
    applyPivot(draft) {
      if (!sheet?.pivot) return;
      setPivotEditorError("");
      void run(() => savePivotConfig(workbookId, sheet.id, draft)).then((failure) => {
        if (failure) setPivotEditorError(failure);
      });
    },

    /** Recomputes the stored summary from the current source range and fields. */
    refreshPivot() {
      if (!sheet?.pivot) return;
      setPivotEditorError("");
      void run(() => refreshPivotTable(workbookId, sheet.id)).then((failure) => {
        if (failure) setPivotEditorError(failure);
      });
    },
  };
}

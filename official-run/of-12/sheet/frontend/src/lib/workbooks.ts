import { apiRequest } from "./api";
import type { CellRange, SelectionRange } from "./spreadsheet";
import type { ColumnCondition, FilterView } from "./filter-view";
import type { ValidationRule } from "./data-validation";
import type { SortOrder } from "./sort-range";
import type { PivotConfig, PivotSettings } from "./pivot";

export type { CellRange } from "./spreadsheet";

export type { ColumnCondition, FilterOperator, FilterView } from "./filter-view";
export type { DropdownRule, NumberRangeRule, ValidationRule } from "./data-validation";
export type { SortColumnOption, SortOrder } from "./sort-range";
export type { PivotConfig, PivotSettings, SummarizeMethod } from "./pivot";

/**
 * Region-bearing record owned by a later feature (validation rule, filter view). The grid only
 * moves its `range` when rows or columns change; every other field is carried verbatim.
 */
export interface WorksheetRegionRecord {
  id: string;
  range: CellRange;
  [field: string]: unknown;
}

/** Pivot configuration stored on the pivot worksheet; the result lives in its cells. */

/** A worksheet of the workbook; `pivot` is set on a worksheet that holds a pivot result. */
export interface Worksheet {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  cells: Record<string, string>;
  selection: SelectionRange;
  validations: ValidationRule[];
  filters: FilterView[];
  pivot: PivotConfig | null;
}

export interface Workbook {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeWorksheetId: string;
  /** Whether the current session holds an operation that can be undone / redone. */
  canUndo: boolean;
  canRedo: boolean;
  worksheets: Worksheet[];
}

export interface WorkbookSummary {
  id: string;
  name: string;
  updatedAt: string;
  worksheetCount: number;
  activeWorksheetName: string | null;
}

export async function listWorkbooks(): Promise<WorkbookSummary[]> {
  const response = await apiRequest<{ workbooks: WorkbookSummary[] }>("/api/workbooks");
  return response.workbooks;
}

export async function fetchWorkbook(workbookId: string): Promise<Workbook> {
  const response = await apiRequest<{ workbook: Workbook }>(`/api/workbooks/${encodeURIComponent(workbookId)}`);
  return response.workbook;
}

export async function createWorkbook(name: string): Promise<Workbook> {
  const response = await apiRequest<{ workbook: Workbook }>("/api/workbooks", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return response.workbook;
}

export async function importCsvWorkbook(fileName: string, content: string): Promise<Workbook> {
  const response = await apiRequest<{ workbook: Workbook }>("/api/workbooks/import", {
    method: "POST",
    body: JSON.stringify({ fileName, content }),
  });
  return response.workbook;
}

export async function renameWorkbook(workbookId: string, name: string): Promise<Workbook> {
  const response = await apiRequest<{ workbook: Workbook }>(`/api/workbooks/${encodeURIComponent(workbookId)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
  return response.workbook;
}

export async function saveCellValue(
  workbookId: string,
  worksheetId: string,
  cell: string,
  value: string,
): Promise<Workbook> {
  const response = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/cells`,
    { method: "PUT", body: JSON.stringify({ worksheetId, cell, value }) },
  );
  return response.workbook;
}

/**
 * Writes a whole pasted table (tab-separated columns, newline-separated rows) starting at `start`.
 * Either every cell of the rectangle is written or, on a rejected paste, none is.
 */
export async function pasteCells(
  workbookId: string,
  worksheetId: string,
  start: string,
  text: string,
): Promise<Workbook> {
  const response = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/paste`,
    { method: "PUT", body: JSON.stringify({ worksheetId, start, text }) },
  );
  return response.workbook;
}

export type RangeTransferMode = "copy" | "cut";

/**
 * Copies or cuts `source` onto the target location of the same worksheet. The server writes the
 * target rectangle (relative formula references follow the offset) and clears the cut source in one
 * state update, or refuses the whole operation.
 */
export async function transferRange(
  workbookId: string,
  worksheetId: string,
  change: { source: CellRange; target: CellRange; mode: RangeTransferMode },
): Promise<Workbook> {
  const response = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/range-transfer`,
    { method: "POST", body: JSON.stringify(change) },
  );
  return response.workbook;
}

/** Restores the workbook state from before the most recent operation of this session. */
export async function undoWorkbook(workbookId: string): Promise<Workbook> {
  const response = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/undo`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return response.workbook;
}

/** Reapplies the operation that was undone last. */
export async function redoWorkbook(workbookId: string): Promise<Workbook> {
  const response = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/redo`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return response.workbook;
}

export async function saveActiveWorksheet(workbookId: string, worksheetId: string): Promise<Workbook> {
  const response = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/active-worksheet`,
    { method: "PUT", body: JSON.stringify({ worksheetId }) },
  );
  return response.workbook;
}

/** `Add worksheet`: a blank tab named with the first unused `SheetN`, made active in A1. */
export async function addWorksheet(workbookId: string): Promise<Workbook> {
  const response = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return response.workbook;
}

/** `Rename` of one worksheet tab; the server trims the name and rejects empty or duplicate ones. */
export async function renameWorksheet(
  workbookId: string,
  worksheetId: string,
  name: string,
): Promise<Workbook> {
  const response = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}`,
    { method: "PATCH", body: JSON.stringify({ name }) },
  );
  return response.workbook;
}

/** Shown when `Delete` targets the last remaining worksheet: no dialog, no deletion. */
export const LAST_WORKSHEET_MESSAGE = "A workbook must contain at least one worksheet";

/**
 * `Delete`: removes the worksheet together with its grid, formulas, rules, filters and pivot
 * result. The server refuses the last remaining worksheet and a worksheet a pivot still reads.
 */
export async function deleteWorksheet(workbookId: string, worksheetId: string): Promise<Workbook> {
  const response = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}`,
    { method: "DELETE" },
  );
  return response.workbook;
}

export type RowStructureAction = "insert-above" | "insert-below" | "delete";
export type ColumnStructureAction = "insert-left" | "insert-right" | "delete";

/** `row` is the decimal row number shown by the row header; `column` is the column letter. */
export async function changeWorksheetRows(
  workbookId: string,
  worksheetId: string,
  change: { action: RowStructureAction; row: number },
): Promise<Workbook> {
  const response = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/rows`,
    { method: "POST", body: JSON.stringify(change) },
  );
  return response.workbook;
}

export async function changeWorksheetColumns(
  workbookId: string,
  worksheetId: string,
  change: { action: ColumnStructureAction; column: string },
): Promise<Workbook> {
  const response = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/columns`,
    { method: "POST", body: JSON.stringify(change) },
  );
  return response.workbook;
}

/** Sorts the records of one rectangular range by one of its columns (`Sort range`). */
export async function sortRange(
  workbookId: string,
  worksheetId: string,
  payload: { range: CellRange; column: string; order: SortOrder; hasHeaderRow: boolean },
): Promise<Workbook> {
  const response = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/sort-range`,
    { method: "POST", body: JSON.stringify(payload) },
  );
  return response.workbook;
}

/** Creates the worksheet's filter view over `range` (`Create filter`). */
export async function createFilterView(
  workbookId: string,
  worksheetId: string,
  range: CellRange,
): Promise<Workbook> {
  const response = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/filters`,
    { method: "POST", body: JSON.stringify({ range }) },
  );
  return response.workbook;
}

/** `Clear filter`: every source record of the worksheet becomes visible again. */
export async function clearFilterView(workbookId: string, worksheetId: string): Promise<Workbook> {
  const response = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/filters`,
    { method: "DELETE" },
  );
  return response.workbook;
}

/** Sets (or clears, with `condition: null`) the filter of one column of the filter view. */
export async function saveColumnFilter(
  workbookId: string,
  worksheetId: string,
  filterId: string,
  column: string,
  condition: ColumnCondition | null,
): Promise<Workbook> {
  const path = `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}`
    + `/filters/${encodeURIComponent(filterId)}/columns/${encodeURIComponent(column)}`;
  const response = await apiRequest<{ workbook: Workbook }>(path, {
    method: "PUT",
    body: JSON.stringify({ condition }),
  });
  return response.workbook;
}

/** Creates a validation rule for `range`, or updates the rule named by `ruleId`. */
export async function saveValidationRule(
  workbookId: string,
  worksheetId: string,
  payload: {
    ruleId?: string;
    type: string;
    range: CellRange;
    values?: string;
    min?: string;
    max?: string;
  },
): Promise<Workbook> {
  const response = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/validations`,
    { method: "POST", body: JSON.stringify(payload) },
  );
  return response.workbook;
}

/** `Delete rule`: removes the constraint without touching the values it covered. */export async function deleteValidationRule(
  workbookId: string,
  worksheetId: string,
  ruleId: string,
): Promise<Workbook> {
  const path = `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}`
    + `/validations/${encodeURIComponent(ruleId)}`;
  const response = await apiRequest<{ workbook: Workbook }>(path, { method: "DELETE" });
  return response.workbook;
}

/**
 * `Create pivot table`: the server creates the first unused `PivotN` worksheet, computes the
 * default summary of `range` and makes the new worksheet the active one.
 */
export async function createPivotTable(
  workbookId: string,
  worksheetId: string,
  range: CellRange,
): Promise<Workbook> {
  const response = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/pivot`,
    { method: "POST", body: JSON.stringify({ range }) },
  );
  return response.workbook;
}

/** `Apply`: replaces the pivot result with a fresh computation of the chosen configuration. */
export async function applyPivotSettings(
  workbookId: string,
  worksheetId: string,
  settings: PivotSettings,
): Promise<Workbook> {
  const response = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/pivot`,
    { method: "PUT", body: JSON.stringify(settings) },
  );
  return response.workbook;
}

/** `Refresh pivot table`: recomputes the stored configuration over the current source range. */
export async function refreshPivotTable(workbookId: string, worksheetId: string): Promise<Workbook> {
  const response = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/pivot/refresh`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return response.workbook;
}

export async function saveSelection(
  workbookId: string,
  worksheetId: string,
  selection: SelectionRange,
): Promise<void> {
  await apiRequest(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/selection`,
    { method: "PUT", body: JSON.stringify(selection) },
  );
}

export function findWorksheet(workbook: Workbook, worksheetId: string): Worksheet | undefined {
  return workbook.worksheets.find((worksheet) => worksheet.id === worksheetId);
}

export function activeWorksheet(workbook: Workbook): Worksheet | undefined {
  return findWorksheet(workbook, workbook.activeWorksheetId) ?? workbook.worksheets[0];
}

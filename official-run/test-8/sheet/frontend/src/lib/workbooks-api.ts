import { ApiError, apiRequest } from "./api";
import type {
  CellCoordinate,
  CellRange,
  CellSelection,
  HistoryState,
  PivotSummarizeMethod,
  PivotTable,
  RangeTransferMode,
  SortRangeSpec,
  ValidationRule,
  ValidationRuleInput,
  Workbook,
  WorkbookSummary,
  Worksheet,
  WorksheetFilter,
  WorksheetStructureOperation,
} from "../domain/types";

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
}

/** A mutation payload: the stored workbook plus the current undo/redo flags. */
export interface WorkbookSessionPayload {
  workbook: Workbook;
  /** Absent when the route does not change the history (the flags are kept). */
  history?: HistoryState;
}

/** Keeps the toolbar flags usable even when a response omits them. */
function sessionPayload(body: { workbook: Workbook; history?: HistoryState }): WorkbookSessionPayload {
  return body.history ? { workbook: body.workbook, history: body.history } : { workbook: body.workbook };
}

export async function listWorkbooks(): Promise<WorkbookSummary[]> {
  const body = await apiRequest<{ workbooks: WorkbookSummary[] }>("/api/workbooks");
  return body.workbooks;
}

export async function fetchWorkbook(id: string): Promise<WorkbookSessionPayload> {
  const body = await apiRequest<{ workbook: Workbook; history?: HistoryState }>(
    `/api/workbooks/${encodeURIComponent(id)}`,
  );
  return sessionPayload(body);
}

export async function createWorkbook(name?: string): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>("/api/workbooks", {
    method: "POST",
    body: JSON.stringify(name === undefined ? {} : { name }),
  });
  return body.workbook;
}

/**
 * Imports CSV text as a new workbook. The server parses the text, so an
 * invalid file fails with `Invalid CSV file format. Import failed.` and no
 * workbook is created.
 */
export async function importWorkbookCsv(fileName: string, content: string): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>("/api/workbooks/import", {
    method: "POST",
    body: JSON.stringify({ fileName, content }),
  });
  return body.workbook;
}

export async function renameWorkbook(id: string, name: string): Promise<WorkbookSessionPayload> {
  const body = await apiRequest<{ workbook: Workbook; history?: HistoryState }>(
    `/api/workbooks/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify({ name }) },
  );
  return sessionPayload(body);
}

export async function setActiveWorksheet(
  id: string,
  worksheetId: string,
): Promise<WorkbookSessionPayload> {
  const body = await apiRequest<{ workbook: Workbook; history?: HistoryState }>(
    `/api/workbooks/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify({ activeWorksheetId: worksheetId }) },
  );
  return sessionPayload(body);
}

/**
 * Appends a blank worksheet named with the first unused `SheetN`; the server
 * makes it the active worksheet and returns the updated workbook.
 */
export async function createWorksheet(id: string): Promise<WorkbookSessionPayload> {
  const body = await apiRequest<{ workbook: Workbook; history?: HistoryState }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets`,
    { method: "POST" },
  );
  return sessionPayload(body);
}

/**
 * Deletes a worksheet and returns the workbook with an adjacent worksheet
 * active. The server drops the pivot tables that summarized into it and
 * rejects the deletion with a message when the worksheet is the last one or
 * still feeds a pivot table, leaving the stored workbook unchanged.
 */
export async function deleteWorksheet(
  id: string,
  worksheetId: string,
): Promise<WorkbookSessionPayload> {
  const body = await apiRequest<{ workbook: Workbook; history?: HistoryState }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}`,
    { method: "DELETE" },
  );
  return sessionPayload(body);
}

/**
 * Renames a worksheet. The server trims the name and rejects empty
 * (`Worksheet name cannot be empty`) or duplicate (`Worksheet name already
 * exists`) names without changing the stored workbook.
 */
export async function renameWorksheet(
  id: string,
  worksheetId: string,
  name: string,
): Promise<WorkbookSessionPayload> {
  const body = await apiRequest<{ worksheet: Worksheet; workbook: Workbook; history?: HistoryState }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}`,
    { method: "PATCH", body: JSON.stringify({ name }) },
  );
  return sessionPayload(body);
}

export async function saveWorksheetSelection(
  id: string,
  worksheetId: string,
  selection: CellSelection,
): Promise<Worksheet> {
  const body = await apiRequest<{ worksheet: Worksheet }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}`,
    { method: "PATCH", body: JSON.stringify({ selection }) },
  );
  return body.worksheet;
}

/**
 * Writes a rectangle of raw text (row-major, starting at `start`) and returns
 * the updated workbook. The server applies the whole rectangle or rejects it
 * with a message, so a failed write never leaves a partially updated grid.
 */
export async function writeWorksheetCells(
  id: string,
  worksheetId: string,
  start: CellCoordinate,
  values: string[][],
): Promise<WorkbookSessionPayload> {
  const body = await apiRequest<{ worksheet: Worksheet; workbook: Workbook; history?: HistoryState }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/cells`,
    { method: "POST", body: JSON.stringify({ start, values }) },
  );
  return sessionPayload(body);
}

/**
 * Copies or cuts a range of the worksheet and pastes it at `target` (its
 * top-left cell). The server plans the whole transfer, so a rejected target
 * (for example a 0-to-100 rule) leaves every involved cell untouched.
 */
export async function transferWorksheetRange(
  id: string,
  worksheetId: string,
  source: CellSelection,
  target: CellCoordinate,
  mode: RangeTransferMode,
): Promise<WorkbookSessionPayload> {
  const body = await apiRequest<{ worksheet: Worksheet; workbook: Workbook; history?: HistoryState }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/transfer`,
    { method: "POST", body: JSON.stringify({ source, target: { anchor: target, focus: target }, mode }) },
  );
  return sessionPayload(body);
}

/**
 * Sorts a rectangular range of the worksheet by one of its columns. The server
 * plans the whole reorder, so a rejected range (for example one outside the
 * grid) leaves every record in its original order; the header row of the range
 * stays out of the sort when `hasHeaderRow` is set.
 */
export async function sortWorksheetRange(
  id: string,
  worksheetId: string,
  spec: SortRangeSpec,
): Promise<WorkbookSessionPayload> {
  const body = await apiRequest<{ worksheet: Worksheet; workbook: Workbook; history?: HistoryState }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/sort`,
    { method: "POST", body: JSON.stringify(spec) },
  );
  return sessionPayload(body);
}

/**
 * Replaces the row filter of one worksheet (or clears it with `null`) and
 * returns the updated workbook. The store keeps the filter, and the grid
 * derives which rows stay visible, so hidden records keep their values.
 */
export async function saveWorksheetFilter(
  id: string,
  worksheetId: string,
  filter: WorksheetFilter | null,
): Promise<WorkbookSessionPayload> {
  const body = await apiRequest<{ worksheet: Worksheet; workbook: Workbook; history?: HistoryState }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/filter`,
    { method: "POST", body: JSON.stringify({ filter }) },
  );
  return sessionPayload(body);
}

/**
 * Saves (or updates) one data-validation rule. The server trims dropdown
 * values, rejects a malformed rule with a message and keeps the stored
 * worksheet unchanged on failure.
 */
export async function saveValidationRule(
  id: string,
  worksheetId: string,
  rule: ValidationRuleInput,
): Promise<WorkbookSessionPayload> {
  const body = await apiRequest<{ worksheet: Worksheet; workbook: Workbook; history?: HistoryState }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/validations`,
    { method: "POST", body: JSON.stringify({ action: "save", rule }) },
  );
  return sessionPayload(body);
}

/** Deletes one data-validation rule, removing its constraint immediately. */
export async function deleteValidationRule(
  id: string,
  worksheetId: string,
  ruleId: string,
): Promise<WorkbookSessionPayload> {
  const body = await apiRequest<{ worksheet: Worksheet; workbook: Workbook; history?: HistoryState }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/validations`,
    { method: "POST", body: JSON.stringify({ action: "delete", id: ruleId }) },
  );
  return sessionPayload(body);
}

/**
 * Inserts or deletes a row/column of the worksheet and returns the updated
 * workbook. The server rejects unknown commands and out-of-range targets
 * (HTTP 400/422) without changing the stored structure.
 */
export async function applyStructureOperation(
  id: string,
  worksheetId: string,
  operation: WorksheetStructureOperation,
  index: number,
): Promise<WorkbookSessionPayload> {
  const body = await apiRequest<{ worksheet: Worksheet; workbook: Workbook; history?: HistoryState }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/structure`,
    { method: "POST", body: JSON.stringify({ operation, index }) },
  );
  return sessionPayload(body);
}

/**
 * Steps one operation back (`undo`) or forward (`redo`) in the workbook's
 * session history and returns the restored state with the fresh flags.
 */
export async function stepWorkbookHistory(
  id: string,
  action: "undo" | "redo",
): Promise<WorkbookSessionPayload> {
  const body = await apiRequest<{ workbook: Workbook; history?: HistoryState }>(
    `/api/workbooks/${encodeURIComponent(id)}/${action}`,
    { method: "POST" },
  );
  return sessionPayload(body);
}

/**
 * Creates a pivot table over a source range of the current worksheet. The
 * server creates the first unused `PivotN` worksheet, stores the default field
 * selections and returns the workbook with that worksheet active.
 */
export async function createPivotTable(
  id: string,
  sourceWorksheetId: string,
  range: CellRange,
): Promise<WorkbookSessionPayload> {
  const body = await apiRequest<{ workbook: Workbook; history?: HistoryState }>(
    `/api/workbooks/${encodeURIComponent(id)}/pivots`,
    { method: "POST", body: JSON.stringify({ action: "create", sourceWorksheetId, range }) },
  );
  return sessionPayload(body);
}

/**
 * Applies a pivot field configuration. The server recomputes the summary into
 * the result worksheet or rejects the whole change with a message, keeping the
 * previous result and the source worksheet untouched.
 */
export async function applyPivotTable(
  id: string,
  pivotId: string,
  selection: {
    rowField: string;
    columnField: string | null;
    valueField: string;
    summarizeBy: PivotSummarizeMethod;
  },
): Promise<WorkbookSessionPayload> {
  const body = await apiRequest<{ workbook: Workbook; history?: HistoryState }>(
    `/api/workbooks/${encodeURIComponent(id)}/pivots`,
    { method: "POST", body: JSON.stringify({ action: "apply", pivotId, ...selection }) },
  );
  return sessionPayload(body);
}

/**
 * Completely replaces the stored pivot result using its current source range.
 * A deleted field or an inapplicable value field rejects the refresh and keeps
 * the last successful result.
 */
export async function refreshPivotTable(
  id: string,
  pivotId: string,
): Promise<WorkbookSessionPayload> {
  const body = await apiRequest<{ workbook: Workbook; history?: HistoryState }>(
    `/api/workbooks/${encodeURIComponent(id)}/pivots`,
    { method: "POST", body: JSON.stringify({ action: "refresh", pivotId }) },
  );
  return sessionPayload(body);
}

import { ApiError, apiRequest } from "../lib/api";
import type { CellRegion } from "../lib/cells";
import type { StructureChangeRequest } from "../editor/structure";
import type {
  ColumnFilterData,
  GridSelectionData,
  PivotFieldInput,
  SortRequestInput,
  ValidationRangeData,
  ValidationRuleInput,
  WorkbookData,
  WorkbookSummary,
} from "./types";

/**
 * Every response that carries a workbook also reports whether the session history of that workbook
 * has a change to undo or to redo (REQ-3-2-2), so the editor toolbar can enable its buttons.
 */
export interface WorkbookPayload {
  workbook: WorkbookData;
  canUndo: boolean;
  canRedo: boolean;
}

interface WorkbookListResponse {
  workbooks: WorkbookSummary[];
}

export async function listWorkbooks(): Promise<WorkbookSummary[]> {
  const response = await apiRequest<WorkbookListResponse>("/api/workbooks");
  return response.workbooks;
}

export async function createWorkbook(name: string): Promise<WorkbookPayload> {
  return apiRequest<WorkbookPayload>("/api/workbooks", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function fetchWorkbook(workbookId: string): Promise<WorkbookPayload> {
  return apiRequest<WorkbookPayload>(`/api/workbooks/${encodeURIComponent(workbookId)}`);
}

export async function saveCellValue(
  workbookId: string,
  worksheetId: string,
  cellId: string,
  value: string,
): Promise<WorkbookPayload> {
  return apiRequest<WorkbookPayload>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/cells/${encodeURIComponent(cellId)}`,
    { method: "PUT", body: JSON.stringify({ value }) },
  );
}

export async function renameWorkbook(workbookId: string, name: string): Promise<WorkbookPayload> {
  return apiRequest<WorkbookPayload>(`/api/workbooks/${encodeURIComponent(workbookId)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

/** Stores which worksheet of the workbook is active; the server answers with the whole workbook. */
export async function saveActiveWorksheet(workbookId: string, worksheetId: string): Promise<WorkbookPayload> {
  return apiRequest<WorkbookPayload>(`/api/workbooks/${encodeURIComponent(workbookId)}`, {
    method: "PATCH",
    body: JSON.stringify({ activeWorksheetId: worksheetId }),
  });
}

/**
 * Adds a blank worksheet named with the first unused `SheetN`; the server makes it the active one.
 */
export async function addWorksheet(workbookId: string): Promise<WorkbookPayload> {
  return apiRequest<WorkbookPayload>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets`,
    { method: "POST" },
  );
}

/** Renames one worksheet; an empty or already used name is rejected by the server. */export async function renameWorksheet(
  workbookId: string,
  worksheetId: string,
  name: string,
): Promise<WorkbookPayload> {
  return apiRequest<WorkbookPayload>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}`,
    { method: "PATCH", body: JSON.stringify({ name }) },
  );
}

/**
 * Deletes one worksheet; the server refuses to remove the last worksheet and a worksheet a pivot
 * table still reads, and answers with the workbook that keeps the remaining worksheets.
 */
export async function deleteWorksheet(workbookId: string, worksheetId: string): Promise<WorkbookPayload> {
  return apiRequest<WorkbookPayload>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}`,
    { method: "DELETE" },
  );
}

/**
 * Stores the rectangle selected in one worksheet. The response is not needed by the caller: the
 * selection shown in the grid is the one the user just made.
 */
export async function saveWorksheetSelection(
  workbookId: string,
  worksheetId: string,
  selection: GridSelectionData,
): Promise<WorkbookPayload> {
  return apiRequest<WorkbookPayload>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}`,
    { method: "PATCH", body: JSON.stringify({ selection }) },
  );
}

/** Applies a pasted table at `cellId`; the server either writes every cell or rejects the whole paste. */
export async function pasteRange(
  workbookId: string,
  worksheetId: string,
  cellId: string,
  values: string[][],
): Promise<WorkbookPayload> {
  return apiRequest<WorkbookPayload>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/paste`,
    { method: "POST", body: JSON.stringify({ cell: cellId, values }) },
  );
}

/** Copies or moves one rectangle inside a worksheet; the server applies the whole operation or none of it. */
export async function transferRange(
  workbookId: string,
  worksheetId: string,
  payload: { mode: "copy" | "cut"; source: CellRegion; target: string },
): Promise<WorkbookPayload> {
  return apiRequest<WorkbookPayload>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/transfer`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

/**
 * Restores the state of the active worksheet as it was before the most recent change of this
 * workbook (REQ-3-2-2). The server answers 409 when the session history holds nothing to undo.
 */
export async function undoWorkbook(workbookId: string): Promise<WorkbookPayload> {
  return apiRequest<WorkbookPayload>(`/api/workbooks/${encodeURIComponent(workbookId)}/undo`, {
    method: "POST",
  });
}

/** Reapplies the last undone change of this workbook as one complete change. */
export async function redoWorkbook(workbookId: string): Promise<WorkbookPayload> {
  return apiRequest<WorkbookPayload>(`/api/workbooks/${encodeURIComponent(workbookId)}/redo`, {
    method: "POST",
  });
}

/**
 * Inserts or deletes one row or column of a worksheet. The server moves cells, formula references,
 * validation rules, the filter view and the selection together in one update, so a rejected change
 * leaves the stored structure as it was.
 */
export async function changeWorksheetStructure(
  workbookId: string,
  worksheetId: string,
  change: StructureChangeRequest,
): Promise<WorkbookPayload> {
  return apiRequest<WorkbookPayload>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/structure`,
    { method: "POST", body: JSON.stringify(change) },
  );
}

/** Creates or replaces the validation rule covering exactly the requested range. */
export async function saveValidationRule(
  workbookId: string,
  worksheetId: string,
  payload: ValidationRuleInput,
): Promise<WorkbookPayload> {
  return apiRequest<WorkbookPayload>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/validations`,
    { method: "PUT", body: JSON.stringify(payload) },
  );
}

/** Creates or replaces the worksheet filter view; `columns` replaces every column filter. */
export async function saveWorksheetFilter(
  workbookId: string,
  worksheetId: string,
  filter: { region: ValidationRangeData; columns: ColumnFilterData[] },
): Promise<WorkbookPayload> {
  return apiRequest<WorkbookPayload>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/filter`,
    { method: "PUT", body: JSON.stringify(filter) },
  );
}

/** Removes the worksheet filter view, so every source row is visible again. */
export async function clearWorksheetFilter(workbookId: string, worksheetId: string): Promise<WorkbookPayload> {
  return apiRequest<WorkbookPayload>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/filter`,
    { method: "DELETE" },
  );
}

/**
 * Sorts one rectangular range of a worksheet by one of its columns (REQ-5-1-1). The server moves
 * the whole records inside the range, so a refused sort leaves the stored order as it was.
 */
export async function sortRange(
  workbookId: string,
  worksheetId: string,
  payload: SortRequestInput,
): Promise<WorkbookPayload> {
  return apiRequest<WorkbookPayload>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/sort`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

/** Removes one validation rule; the values it constrained stay in their cells. */
export async function deleteValidationRule(
  workbookId: string,
  worksheetId: string,
  ruleId: string,
): Promise<WorkbookPayload> {
  return apiRequest<WorkbookPayload>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/validations/${encodeURIComponent(ruleId)}`,
    { method: "DELETE" },
  );
}

/** Creates the pivot result worksheet of one source range (REQ-5-3-1); the server names it `PivotN`. */
export async function createPivotTable(
  workbookId: string,
  payload: { sourceWorksheetId: string; sourceRange: CellRegion },
): Promise<WorkbookPayload> {
  return apiRequest<WorkbookPayload>(`/api/workbooks/${encodeURIComponent(workbookId)}/pivots`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Applies one field selection of the pivot table editor; a rejected configuration stores nothing. */
export async function applyPivotFields(
  workbookId: string,
  worksheetId: string,
  payload: PivotFieldInput,
): Promise<WorkbookPayload> {
  return apiRequest<WorkbookPayload>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/pivot`,
    { method: "PUT", body: JSON.stringify(payload) },
  );
}

/**
 * Rebuilds the summary of a pivot worksheet from its stored configuration and the current source
 * data; a failure keeps the last successful result.
 */
export async function refreshPivotTable(workbookId: string, worksheetId: string): Promise<WorkbookPayload> {
  return apiRequest<WorkbookPayload>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/pivot/refresh`,
    { method: "POST" },
  );
}

export async function importCsvWorkbook(fileName: string, content: string): Promise<WorkbookPayload> {
  return apiRequest<WorkbookPayload>("/api/workbooks/import", {
    method: "POST",
    body: JSON.stringify({ fileName, content }),
  });
}

export function requestErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "The request could not be completed. Please try again.";
}

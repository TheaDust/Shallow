import { apiRequest } from "../lib/api";
import type { SortOrder } from "./sort";
import type { PivotMethod } from "./types";
import type {
  CellInput,
  FilterRule,
  Selection,
  StructureCommand,
  Workbook,
  WorkbookSummary,
  WorksheetSnapshot,
} from "./types";

export async function fetchWorkbooks(): Promise<WorkbookSummary[]> {
  const body = await apiRequest<{ workbooks: WorkbookSummary[] }>("/api/workbooks");
  return body.workbooks;
}

export async function fetchWorkbook(id: string): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(`/api/workbooks/${encodeURIComponent(id)}`);
  return body.workbook;
}

export async function createBlankWorkbook(name: string): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>("/api/workbooks", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return body.workbook;
}

export async function importCsvWorkbook(fileName: string, content: string): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>("/api/workbooks/import", {
    method: "POST",
    body: JSON.stringify({ fileName, content }),
  });
  return body.workbook;
}

export async function renameWorkbook(id: string, name: string): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(`/api/workbooks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
  return body.workbook;
}

export async function setActiveWorksheet(id: string, worksheetId: string): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(`/api/workbooks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ activeWorksheetId: worksheetId }),
  });
  return body.workbook;
}

export async function addWorksheet(id: string): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets`,
    { method: "POST" },
  );
  return body.workbook;
}

export async function renameWorksheet(id: string, worksheetId: string, name: string): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}`,
    { method: "PATCH", body: JSON.stringify({ name }) },
  );
  return body.workbook;
}

/** Deletes one worksheet; an adjacent worksheet becomes active (REQ-2-1-4). */
export async function deleteWorksheet(id: string, worksheetId: string): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}`,
    { method: "DELETE" },
  );
  return body.workbook;
}

/** Inserts or deletes one row/column of a worksheet, returning the updated workbook. */
export async function changeWorksheetStructure(
  id: string,
  worksheetId: string,
  command: StructureCommand,
): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/${command.axis === "row" ? "rows" : "columns"}`,
    { method: "POST", body: JSON.stringify({ action: command.action, index: command.index }) },
  );
  return body.workbook;
}

/** Writes one or more cells (and optionally the selection) in one atomic change. */
export async function writeWorksheetCells(
  id: string,
  worksheetId: string,
  payload: { updates: CellInput[]; selection?: Selection },
): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/cells`,
    { method: "PATCH", body: JSON.stringify(payload) },
  );
  return body.workbook;
}

/** Stores the selection rectangle of one worksheet. */
export async function saveWorksheetSelection(
  id: string,
  worksheetId: string,
  selection: Selection,
): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/selection`,
    { method: "PATCH", body: JSON.stringify(selection) },
  );
  return body.workbook;
}

/** Copies or cuts a range of one worksheet onto a target location in one atomic change. */
export async function transferWorksheetRange(
  id: string,
  worksheetId: string,
  payload: { mode: "copy" | "cut"; source: Selection; target: Selection },
): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/range`,
    { method: "POST", body: JSON.stringify(payload) },
  );
  return body.workbook;
}

/** Stores the filter view (region plus column rules) of one worksheet. */
export async function setWorksheetFilter(
  id: string,
  worksheetId: string,
  payload: { range: string; rules: FilterRule[] },
): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/filter`,
    { method: "POST", body: JSON.stringify(payload) },
  );
  return body.workbook;
}

/** Removes the filter view of one worksheet, restoring every source row. */
export async function clearWorksheetFilter(id: string, worksheetId: string): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/filter`,
    { method: "DELETE" },
  );
  return body.workbook;
}

/** Stably sorts the data rows of one selected range by one of its columns. */
export async function sortWorksheetRange(
  id: string,
  worksheetId: string,
  payload: { range: string; column: number; order: SortOrder; hasHeader: boolean },
): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/sort`,
    { method: "POST", body: JSON.stringify(payload) },
  );
  return body.workbook;
}

/** Applies a dropdown or number validation rule to one range of a worksheet. */
export async function saveWorksheetValidation(
  id: string,
  worksheetId: string,
  payload: { range: string; type: "list" | "number"; values?: string[]; min?: number; max?: number },
): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/validations`,
    { method: "POST", body: JSON.stringify(payload) },
  );
  return body.workbook;
}

/** Removes the validation rule bound to one range, without touching cell values. */
export async function deleteWorksheetValidation(
  id: string,
  worksheetId: string,
  range: string,
): Promise<Workbook> {
  const query = `?range=${encodeURIComponent(range)}`;
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/validations${query}`,
    { method: "DELETE" },
  );
  return body.workbook;
}

/** Creates a pivot-result worksheet from one source range (REQ-5-3-1). */
export async function createPivotTable(
  id: string,
  payload: { sourceWorksheetId: string; range: string },
): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/pivots`,
    { method: "POST", body: JSON.stringify(payload) },
  );
  return body.workbook;
}

/** Applies one pivot configuration; the result worksheet keeps its last success on failure. */
export async function applyPivotTable(
  id: string,
  worksheetId: string,
  payload: {
    rowField: string;
    columnField: string | null;
    valueField: string;
    summarizeBy: PivotMethod;
  },
): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/pivot`,
    { method: "POST", body: JSON.stringify(payload) },
  );
  return body.workbook;
}

/** Recomputes a pivot from the current source data, replacing the previous summary. */
export async function refreshPivotTable(id: string, worksheetId: string): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/pivot/refresh`,
    { method: "POST" },
  );
  return body.workbook;
}

/** Replaces one worksheet with a captured snapshot (undo/redo). */
export async function restoreWorksheet(
  id: string,
  worksheetId: string,
  snapshot: WorksheetSnapshot,
): Promise<Workbook> {
  const body = await apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/restore`,
    { method: "POST", body: JSON.stringify(snapshot) },
  );
  return body.workbook;
}

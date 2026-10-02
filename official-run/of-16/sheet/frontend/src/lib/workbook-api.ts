import { apiRequest } from "./api";
import type { WorksheetSnapshot } from "../domain/history";
import type { SortRangeRequest } from "../domain/sort";
import type { CellRef, PivotFields, StructureAction, StructureAxis, ValidationRule, Workbook, WorkbookSummary, WorksheetFilter } from "../domain/workbook";

interface WorkbookEnvelope {
  workbook: Workbook;
}

export async function listWorkbooks(): Promise<WorkbookSummary[]> {
  const body = await apiRequest<{ workbooks: WorkbookSummary[] }>("/api/workbooks");
  return body.workbooks ?? [];
}

export async function getWorkbook(id: string): Promise<Workbook> {
  const body = await apiRequest<WorkbookEnvelope>(`/api/workbooks/${encodeURIComponent(id)}`);
  return body.workbook;
}

export async function createWorkbook(id: string, name: string): Promise<Workbook> {
  const body = await apiRequest<WorkbookEnvelope>("/api/workbooks", {
    method: "POST",
    body: JSON.stringify({ id, name }),
  });
  return body.workbook;
}

/** Creates a new workbook from an uploaded CSV file (name = file name without .csv). */
export async function importWorkbookCsv(fileName: string, content: string): Promise<Workbook> {
  const body = await apiRequest<WorkbookEnvelope>("/api/workbooks/import", {
    method: "POST",
    body: JSON.stringify({ fileName, content }),
  });
  return body.workbook;
}

/** Appends a blank worksheet; the API picks the first unused `SheetN` name. */
export async function addWorksheet(id: string): Promise<Workbook> {
  const body = await apiRequest<WorkbookEnvelope>(`/api/workbooks/${encodeURIComponent(id)}/worksheets`, {
    method: "POST",
  });
  return body.workbook;
}

/**
 * Renames one worksheet; empty and duplicate names are rejected by the API with
 * the messages the dialog shows next to the `Worksheet name` control.
 */
export async function renameWorksheet(id: string, worksheetId: string, name: string): Promise<Workbook> {
  const body = await apiRequest<WorkbookEnvelope>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}`,
    { method: "PATCH", body: JSON.stringify({ name }) },
  );
  return body.workbook;
}

/**
 * Deletes one worksheet inside its workbook (REQ-2-1-4). The server rejects the
 * removal when it would leave the workbook without a worksheet or when a
 * pivot-result worksheet still reads the target; the answer carries the updated
 * workbook, so the tab bar and the active worksheet follow it.
 */
export async function deleteWorksheet(id: string, worksheetId: string): Promise<Workbook> {
  const body = await apiRequest<WorkbookEnvelope>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}`,
    { method: "DELETE" },
  );
  return body.workbook;
}

/** Renames a workbook; the empty-name rejection is enforced by the API. */
export async function renameWorkbook(id: string, name: string): Promise<Workbook> {
  const body = await apiRequest<WorkbookEnvelope>(`/api/workbooks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
  return body.workbook;
}

/**
 * Inserts or deletes one row (`axis: "row"`, index = target row) or column
 * (`axis: "column"`, index = target column) of one worksheet (REQ-2-2). The
 * response workbook is authoritative: it carries the moved values, adjusted
 * formulas and the updated grid size.
 */
export async function changeWorksheetStructure(
  id: string,
  worksheetId: string,
  axis: StructureAxis,
  action: StructureAction,
  index: number,
): Promise<Workbook> {
  const segment = axis === "row" ? "rows" : "columns";
  const body = await apiRequest<WorkbookEnvelope>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/${segment}`,
    { method: "POST", body: JSON.stringify({ action, index }) },
  );
  return body.workbook;
}

export async function saveWorkbookState(
  id: string,
  patch: { activeWorksheetId?: string; selection?: { worksheetId: string } & ({ anchor: CellRef; focus: CellRef } | CellRef) },
): Promise<Workbook> {
  const body = await apiRequest<WorkbookEnvelope>(`/api/workbooks/${encodeURIComponent(id)}/state`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return body.workbook;
}

export async function saveWorksheetCells(
  id: string,
  worksheetId: string,
  cells: Record<string, string | null>,
): Promise<Workbook> {
  const body = await apiRequest<WorkbookEnvelope>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/cells`,
    { method: "PATCH", body: JSON.stringify({ cells }) },
  );
  return body.workbook;
}

/**
 * Replaces the complete validation rule list of one worksheet (REQ-5-2-1). The
 * server validates the whole payload before writing, so a rejected save keeps
 * the rules that were stored before.
 */
export async function saveWorksheetValidations(
  id: string,
  worksheetId: string,
  validations: readonly ValidationRule[],
): Promise<Workbook> {
  const body = await apiRequest<WorkbookEnvelope>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/validations`,
    { method: "PUT", body: JSON.stringify({ validations }) },
  );
  return body.workbook;
}

/**
 * Stores the filter view of one worksheet, or clears it with `null`
 * ("Clear filter", REQ-5-1-2). Only the region and its rules are persisted; the
 * hidden rows stay derivable from the stored cells.
 */
export async function saveWorksheetFilter(
  id: string,
  worksheetId: string,
  filter: WorksheetFilter | null,
): Promise<Workbook> {
  const body = await apiRequest<WorkbookEnvelope>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/filter`,
    { method: "PUT", body: JSON.stringify({ filter }) },
  );
  return body.workbook;
}

/**
 * Sorts the selected rectangle of one worksheet (REQ-5-1-1). The server
 * validates the whole request before writing, so a rejected sort returns an
 * error and the grid keeps its original order.
 */
export async function sortWorksheetRange(
  id: string,
  worksheetId: string,
  request: SortRangeRequest,
): Promise<Workbook> {
  const body = await apiRequest<WorkbookEnvelope>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/sort`,
    { method: "POST", body: JSON.stringify(request) },
  );
  return body.workbook;
}

/**
 * Replaces the complete content state of one worksheet with a previously
 * captured snapshot (undo/redo of REQ-3-2-2). The server validates the whole
 * payload before writing, so a rejected restore keeps the stored state.
 */
export async function replaceWorksheetState(
  id: string,
  worksheetId: string,
  snapshot: WorksheetSnapshot,
): Promise<Workbook> {
  const body = await apiRequest<WorkbookEnvelope>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}`,
    { method: "PUT", body: JSON.stringify(snapshot) },
  );
  return body.workbook;
}

/**
 * Creates the pivot-result worksheet of one source range (REQ-5-3-1). The server
 * names it after the first unused `PivotN` (Pivot1 when none exists) and answers
 * with the whole workbook, so the new tab, its pivot configuration and its A1
 * selection are all authoritative.
 */
export async function createPivotTable(
  id: string,
  request: { sourceWorksheetId: string; range: string },
): Promise<Workbook> {
  const body = await apiRequest<WorkbookEnvelope>(`/api/workbooks/${encodeURIComponent(id)}/pivot`, {
    method: "POST",
    body: JSON.stringify(request),
  });
  return body.workbook;
}

/**
 * Stores the chosen pivot fields and recomputes the summary ("Apply"). A field
 * that the source headers no longer provide is rejected by the server, which
 * keeps the last successful result and both worksheets.
 */
export async function configurePivotTable(
  id: string,
  worksheetId: string,
  fields: PivotFields,
): Promise<Workbook> {
  const body = await apiRequest<WorkbookEnvelope>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/pivot`,
    { method: "PUT", body: JSON.stringify(fields) },
  );
  return body.workbook;
}

/**
 * Recomputes one pivot worksheet from the current source content ("Refresh pivot
 * table"), completely replacing the previous summary on success. An unusable
 * stored field or source range is reported and keeps the previous result.
 */
export async function refreshPivotTable(id: string, worksheetId: string): Promise<Workbook> {
  const body = await apiRequest<WorkbookEnvelope>(
    `/api/workbooks/${encodeURIComponent(id)}/worksheets/${encodeURIComponent(worksheetId)}/pivot/refresh`,
    { method: "POST" },
  );
  return body.workbook;
}

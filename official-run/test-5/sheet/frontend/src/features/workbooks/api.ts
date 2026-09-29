import { ApiError, apiRequest } from "../../lib/api";

import type { WorkbookData, WorkbookSummary } from "./types";
import type { CellRange, TransferMode } from "./rangeTransfer";
import type { StructureAxis, StructureOperation } from "./structure";

export { ApiError };

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
}

export function listWorkbooks(): Promise<{ workbooks: WorkbookSummary[] }> {
  return apiRequest<{ workbooks: WorkbookSummary[] }>("/api/workbooks");
}

export function getWorkbook(workbookId: string): Promise<{ workbook: WorkbookData }> {
  return apiRequest<{ workbook: WorkbookData }>(`/api/workbooks/${encodeURIComponent(workbookId)}`);
}

export function createWorkbook(name: string): Promise<{ workbook: WorkbookData }> {
  return apiRequest<{ workbook: WorkbookData }>("/api/workbooks", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function importWorkbookCsv(fileName: string, content: string): Promise<{ workbook: WorkbookData }> {
  return apiRequest<{ workbook: WorkbookData }>("/api/workbooks/import", {
    method: "POST",
    body: JSON.stringify({ fileName, content }),
  });
}

export function renameWorkbook(workbookId: string, name: string): Promise<{ workbook: WorkbookData }> {
  return apiRequest<{ workbook: WorkbookData }>(`/api/workbooks/${encodeURIComponent(workbookId)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

/** Same-origin URL that streams the active worksheet back as a CSV download. */
export function exportWorksheetCsvUrl(workbookId: string, worksheetId: string): string {
  return `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/export`;
}

export function setActiveWorksheet(workbookId: string, worksheetId: string): Promise<{ workbook: WorkbookData }> {
  return apiRequest<{ workbook: WorkbookData }>(`/api/workbooks/${encodeURIComponent(workbookId)}`, {
    method: "PATCH",
    body: JSON.stringify({ activeWorksheetId: worksheetId }),
  });
}

function worksheetPath(workbookId: string, worksheetId: string): string {
  return `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}`;
}

/** Appends a blank worksheet named after the first unused `SheetN` and activates it. */
export function addWorksheet(workbookId: string): Promise<{ workbook: WorkbookData }> {
  return apiRequest<{ workbook: WorkbookData }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export function renameWorksheet(
  workbookId: string,
  worksheetId: string,
  name: string,
): Promise<{ workbook: WorkbookData }> {
  return apiRequest<{ workbook: WorkbookData }>(worksheetPath(workbookId, worksheetId), {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export function setActiveCell(
  workbookId: string,
  worksheetId: string,
  activeCell: string,
): Promise<{ workbook: WorkbookData }> {
  return apiRequest<{ workbook: WorkbookData }>(worksheetPath(workbookId, worksheetId), {
    method: "PATCH",
    body: JSON.stringify({ activeCell }),
  });
}

/** Persists the complete selection rectangle (anchor plus opposite corner). */
export function setSelection(
  workbookId: string,
  worksheetId: string,
  selection: { anchor: string; focus: string },
): Promise<{ workbook: WorkbookData }> {
  return apiRequest<{ workbook: WorkbookData }>(worksheetPath(workbookId, worksheetId), {
    method: "PATCH",
    body: JSON.stringify({ activeCell: selection.anchor, selectionFocus: selection.focus }),
  });
}

/**
 * Commits raw cell texts in one all-or-nothing request; an empty text clears the
 * cell. The answer carries the recalculated display values of the worksheet.
 */
export function setCells(
  workbookId: string,
  worksheetId: string,
  updates: Record<string, string>,
): Promise<{ workbook: WorkbookData }> {
  return apiRequest<{ workbook: WorkbookData }>(`${worksheetPath(workbookId, worksheetId)}/cells`, {
    method: "POST",
    body: JSON.stringify({ updates }),
  });
}

/**
 * Inserts or deletes one row/column of a worksheet. `index` is the 1-based row
 * number for the `row` axis and the 1-based column index for the `column` axis.
 */
export function applyStructureCommand(
  workbookId: string,
  worksheetId: string,
  axis: StructureAxis,
  operation: StructureOperation,
  index: number,
): Promise<{ workbook: WorkbookData }> {
  const body = axis === "row" ? { op: operation, row: index } : { op: operation, column: index };
  return apiRequest<{ workbook: WorkbookData }>(
    `${worksheetPath(workbookId, worksheetId)}/${axis === "row" ? "rows" : "columns"}`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

/**
 * Copies or cuts `source` and places it at the top-left corner of `target` in
 * one atomic write; the answer carries the recalculated display values.
 */
export function transferRange(
  workbookId: string,
  worksheetId: string,
  request: { mode: TransferMode; source: CellRange; target: CellRange },
): Promise<{ workbook: WorkbookData }> {
  return apiRequest<{ workbook: WorkbookData }>(`${worksheetPath(workbookId, worksheetId)}/range-transfer`, {
    method: "POST",
    body: JSON.stringify(request),
  });
}

/**
 * Repositions the worksheet's row filter (or removes it with `null`). The
 * answer carries the recalculated `hiddenRows` of the filtered region.
 */
export function setFilter(
  workbookId: string,
  worksheetId: string,
  filter: unknown,
): Promise<{ workbook: WorkbookData }> {
  return apiRequest<{ workbook: WorkbookData }>(worksheetPath(workbookId, worksheetId), {
    method: "PATCH",
    body: JSON.stringify({ filter }),
  });
}

/** Replaces the validation rules of a worksheet in one write. */
export function setValidations(
  workbookId: string,
  worksheetId: string,
  validations: readonly unknown[],
): Promise<{ workbook: WorkbookData }> {
  return apiRequest<{ workbook: WorkbookData }>(worksheetPath(workbookId, worksheetId), {
    method: "PATCH",
    body: JSON.stringify({ validations }),
  });
}

/** Restores the state before the last recorded operation of the workbook. */
export function undoWorkbook(workbookId: string): Promise<{ workbook: WorkbookData }> {
  return apiRequest<{ workbook: WorkbookData }>(`/api/workbooks/${encodeURIComponent(workbookId)}/undo`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/** Reapplies the operation that was undone last. */
export function redoWorkbook(workbookId: string): Promise<{ workbook: WorkbookData }> {
  return apiRequest<{ workbook: WorkbookData }>(`/api/workbooks/${encodeURIComponent(workbookId)}/redo`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

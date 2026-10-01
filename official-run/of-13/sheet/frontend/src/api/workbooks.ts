import { apiRequest } from "../lib/api";
import type { ColumnStructureAction, RowStructureAction } from "../domain/structure";
import type { CellSelection } from "../domain/spreadsheet";
import type { RangeTransferMode } from "../domain/clipboard";
import type { WorksheetSnapshot } from "../domain/history";
import type { WorkbookState, WorkbookSummary, WorksheetFilter, WorksheetState, ValidationRule } from "../domain/workbook";
import type { PivotConfig } from "../domain/workbook";
import type { SortRequest } from "../domain/sort";

export function fetchWorkbooks(): Promise<{ workbooks: WorkbookSummary[] }> {
  return apiRequest<{ workbooks: WorkbookSummary[] }>("/api/workbooks");
}

export function fetchWorkbook(id: string): Promise<{ workbook: WorkbookState }> {
  return apiRequest<{ workbook: WorkbookState }>(`/api/workbooks/${encodeURIComponent(id)}`);
}

export function createWorkbook(name: string): Promise<{ workbook: WorkbookState }> {
  return apiRequest<{ workbook: WorkbookState }>("/api/workbooks", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

/** Imports a CSV file; the server parses it and creates the workbook, or rejects it. */
export function importWorkbookFromCsv(
  fileName: string,
  content: string,
): Promise<{ workbook: WorkbookState }> {
  return apiRequest<{ workbook: WorkbookState }>("/api/workbooks/import", {
    method: "POST",
    body: JSON.stringify({ fileName, content }),
  });
}

export function renameWorkbook(id: string, name: string): Promise<{ workbook: WorkbookState }> {
  return apiRequest<{ workbook: WorkbookState }>(`/api/workbooks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

/** Adds a blank worksheet named after the first unused `SheetN` and activates it. */
export function addWorksheet(
  id: string,
): Promise<{ workbook: WorkbookState; worksheet: WorksheetState }> {
  return apiRequest<{ workbook: WorkbookState; worksheet: WorksheetState }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets`,
    { method: "POST" },
  );
}

/** Renames one worksheet; the server trims the name and enforces uniqueness. */
export function renameWorksheet(
  id: string,
  sheetId: string,
  name: string,
): Promise<{ workbook: WorkbookState }> {
  return apiRequest<{ workbook: WorkbookState }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}`,
    { method: "PATCH", body: JSON.stringify({ name }) },
  );
}

/**
 * Deletes one worksheet with its cells, formulas, filters, validation rules and pivot state.
 * The server refuses the last remaining worksheet and a worksheet a pivot table still reads,
 * answering with the contract message and leaving the workbook untouched.
 */
export function deleteWorksheet(id: string, sheetId: string): Promise<{ workbook: WorkbookState }> {
  return apiRequest<{ workbook: WorkbookState }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}`,
    { method: "DELETE" },
  );
}

/** Inserts or deletes one row of one worksheet; `row` is the 1-based row number. */
export function changeRowStructure(
  id: string,
  sheetId: string,
  action: RowStructureAction,
  row: number,
): Promise<{ workbook: WorkbookState }> {
  return apiRequest<{ workbook: WorkbookState }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}/rows`,
    { method: "POST", body: JSON.stringify({ action, row }) },
  );
}

/** Inserts or deletes one column of one worksheet; `column` is the 1-based column number. */
export function changeColumnStructure(
  id: string,
  sheetId: string,
  action: ColumnStructureAction,
  column: number,
): Promise<{ workbook: WorkbookState }> {
  return apiRequest<{ workbook: WorkbookState }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}/columns`,
    { method: "POST", body: JSON.stringify({ action, column }) },
  );
}

export function setActiveWorksheet(id: string, activeSheetId: string): Promise<{ workbook: WorkbookState }> {
  return apiRequest<{ workbook: WorkbookState }>(`/api/workbooks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ activeSheetId }),
  });
}

/**
 * Commits one cell. The response carries the freshly calculated values of every dependent
 * formula, so a successful commit updates the whole grid at once.
 */
export function updateCell(
  id: string,
  sheetId: string,
  address: string,
  value: string,
): Promise<{ workbook: WorkbookState }> {
  return apiRequest<{ workbook: WorkbookState }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}/cells/${encodeURIComponent(address)}`,
    { method: "PUT", body: JSON.stringify({ value }) },
  );
}

/** Pastes external clipboard text as a rectangle starting at `start`. */
export function pasteCells(
  id: string,
  sheetId: string,
  start: string,
  text: string,
): Promise<{ workbook: WorkbookState }> {
  return apiRequest<{ workbook: WorkbookState }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}/paste`,
    { method: "POST", body: JSON.stringify({ start, text }) },
  );
}

/** Saves the complete rectangle of the most recent selection of one worksheet. */
export function saveWorksheetSelection(
  id: string,
  sheetId: string,
  selection: CellSelection,
): Promise<{ workbook: WorkbookState }> {
  return apiRequest<{ workbook: WorkbookState }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}`,
    { method: "PATCH", body: JSON.stringify({ selection }) },
  );
}

/**
 * Stores the filter view of one worksheet (`null` clears it). The response carries the hidden
 * row numbers derived from it, so the grid renders exactly what the server computed.
 */
export function saveWorksheetFilter(
  id: string,
  sheetId: string,
  filter: WorksheetFilter | null,
): Promise<{ workbook: WorkbookState }> {
  return apiRequest<{ workbook: WorkbookState }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}/filter`,
    { method: "PUT", body: JSON.stringify({ filter }) },
  );
}

/** Replaces the data-validation rules of one worksheet with the submitted list. */
export function saveWorksheetValidations(
  id: string,
  sheetId: string,
  validations: ValidationRule[],
): Promise<{ workbook: WorkbookState }> {
  return apiRequest<{ workbook: WorkbookState }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}/validations`,
    { method: "PUT", body: JSON.stringify({ validations }) },
  );
}

/**
 * Sorts one rectangular range of one worksheet (REQ-5-1-1). The server validates the range,
 * the column inside it and the direction, then moves every record of the data rows; a refused
 * request answers with a message and leaves the worksheet in its previous order.
 */
export function sortWorksheetRange(
  id: string,
  sheetId: string,
  request: SortRequest,
): Promise<{ workbook: WorkbookState }> {
  return apiRequest<{ workbook: WorkbookState }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}/sort`,
    { method: "POST", body: JSON.stringify(request) },
  );
}

/**
 * Creates the pivot-result worksheet of one source range (REQ-5-3). The server names it after
 * the first unused `PivotN`, stores the pending configuration and activates it; the source
 * worksheet is only read.
 */
export function createPivotTable(
  id: string,
  sourceSheetId: string,
  sourceRange: string,
): Promise<{ workbook: WorkbookState; worksheet: WorksheetState }> {
  return apiRequest<{ workbook: WorkbookState; worksheet: WorksheetState }>(
    `/api/workbooks/${encodeURIComponent(id)}/pivots`,
    { method: "POST", body: JSON.stringify({ sourceSheetId, sourceRange }) },
  );
}

/**
 * Applies the fields and summarization method of one pivot table and stores the recomputed
 * summary. A refused configuration (deleted header, no parseable numbers) answers with the
 * contract message and leaves the last successful summary in place.
 */
export function savePivotConfig(
  id: string,
  sheetId: string,
  config: Pick<PivotConfig, "rowField" | "columnField" | "valueField" | "method">,
): Promise<{ workbook: WorkbookState }> {
  return apiRequest<{ workbook: WorkbookState }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}/pivot`,
    { method: "PUT", body: JSON.stringify(config) },
  );
}

/** Recomputes the stored pivot summary from the current source range and its stored fields. */
export function refreshPivotTable(id: string, sheetId: string): Promise<{ workbook: WorkbookState }> {
  return apiRequest<{ workbook: WorkbookState }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}/pivot/refresh`,
    { method: "POST" },
  );
}

/**
 * Copies or cuts one rectangle onto a target rectangle of the same worksheet. The server
 * applies the whole transfer (translating copied formulas) or refuses it, so the source,
 * the target and every dependent formula change together or not at all.
 */
export function transferRange(
  id: string,
  sheetId: string,
  source: CellSelection,
  target: CellSelection,
  mode: RangeTransferMode,
): Promise<{ workbook: WorkbookState }> {
  return apiRequest<{ workbook: WorkbookState }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}/range-transfer`,
    { method: "POST", body: JSON.stringify({ source, target, mode }) },
  );
}

/**
 * Puts one worksheet back to a previously captured state (undo/redo). The stored grid size
 * is sent as `null` when the snapshot had none, so a structure change is fully reversible.
 */
export function restoreWorksheetState(
  id: string,
  sheetId: string,
  snapshot: WorksheetSnapshot,
): Promise<{ workbook: WorkbookState }> {
  return apiRequest<{ workbook: WorkbookState }>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}/state`,
    {
      method: "PUT",
      body: JSON.stringify({
        cells: snapshot.cells,
        rowCount: snapshot.rowCount ?? null,
        columnCount: snapshot.columnCount ?? null,
        validations: snapshot.validations,
      }),
    },
  );
}

import { apiRequest } from "../lib/api";
import type {
  ConditionalRule,
  PivotConfig,
  ValidationRule,
  Workbook,
  WorkbookSummary,
  WorksheetFilter,
  WorksheetFreeze,
} from "../domain/types";

export function fetchWorkbooks(): Promise<WorkbookSummary[]> {
  return apiRequest<{ workbooks: WorkbookSummary[] }>("/api/workbooks").then((body) => body.workbooks);
}

export function fetchWorkbook(id: string): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(`/api/workbooks/${encodeURIComponent(id)}`).then(
    (body) => body.workbook,
  );
}

export function createWorkbook(name: string): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>("/api/workbooks", {
    method: "POST",
    body: JSON.stringify({ name }),
  }).then((body) => body.workbook);
}

export function importWorkbook(fileName: string, rows: string[][]): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>("/api/workbooks/import", {
    method: "POST",
    body: JSON.stringify({ fileName, rows }),
  }).then((body) => body.workbook);
}

export function renameWorkbook(id: string, name: string): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(`/api/workbooks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  }).then((body) => body.workbook);
}

/** Adds a blank worksheet with the first unused SheetN name; it becomes active. */
export function addWorksheet(workbookId: string): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets`,
    { method: "POST" },
  ).then((body) => body.workbook);
}

/** Renames one worksheet of a workbook; the server trims and validates the name. */
export function renameWorksheet(workbookId: string, worksheetId: string, name: string): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}`,
    { method: "PATCH", body: JSON.stringify({ name }) },
  ).then((body) => body.workbook);
}

/**
 * Deletes one worksheet. The server keeps at least one worksheet and rejects a
 * worksheet that a pivot result still reads (its message is shown as it is), so
 * a rejected call leaves every worksheet and pivot result unchanged.
 */
export function deleteWorksheet(workbookId: string, worksheetId: string): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}`,
    { method: "DELETE" },
  ).then((body) => body.workbook);
}

export function setActiveWorksheet(id: string, worksheetId: string): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(`/api/workbooks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ activeWorksheetId: worksheetId }),
  }).then((body) => body.workbook);
}

export type StructureAxis = "row" | "column";
export type StructureMode = "insert-before" | "insert-after" | "delete";

/** One sort of a rectangle: its column, direction and whether row 1 is a header. */
export interface SortRangeRequest {
  /** A1 area of the range to reorder. */
  range: string;
  /** Absolute 1-based column to sort by. */
  column: number;
  order: "asc" | "desc";
  hasHeaderRow: boolean;
}

/**
 * Reorders the records of one range in one atomic request. The server moves a
 * whole row at a time and keeps values outside the range untouched, so a
 * rejected sort leaves the grid in its original order.
 */
export function sortRange(
  workbookId: string,
  worksheetId: string,
  request: SortRangeRequest,
): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/sort`,
    { method: "POST", body: JSON.stringify(request) },
  ).then((body) => body.workbook);
}

/**
 * Inserts or deletes one row or column of a worksheet. The server performs the
 * whole shift (values and formula references) in one atomic write and returns
 * the workbook's new stored state, so a failed call keeps the previous grid.
 */
export function changeStructure(
  workbookId: string,
  worksheetId: string,
  change: { axis: StructureAxis; mode: StructureMode; index: number },
): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/structure`,
    { method: "POST", body: JSON.stringify(change) },
  ).then((body) => body.workbook);
}

/** Writes one cell of one worksheet; returns the workbook's new stored state. */
export function updateCell(
  workbookId: string,
  worksheetId: string,
  coordinate: string,
  value: string,
): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/cells`,
    { method: "PATCH", body: JSON.stringify({ coordinate, value }) },
  ).then((body) => body.workbook);
}

/**
 * Writes a whole rectangle of text values (row-major, starting at `start`) in
 * one atomic request. A rejected paste changes nothing server-side.
 */
export function applyCellRange(
  workbookId: string,
  worksheetId: string,
  start: string,
  rows: string[][],
): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/cells/batch`,
    { method: "POST", body: JSON.stringify({ start, rows }) },
  ).then((body) => body.workbook);
}

export interface RangeTransferRequest {
  /** Top-left cell of the target rectangle. */
  target: string;
  /** Row-major raw cell texts written onto the target. */
  rows: string[][];
  /** Source area cleared after the target is written (a cut); omitted for a copy. */
  source?: string;
}

/**
 * Transfers a rectangle onto a target in one atomic write. A cut also clears
 * the cells of `source` that are outside the target; a rejected transfer (for
 * example a broken validation rule) leaves both ranges untouched.
 */
export function transferRange(
  workbookId: string,
  worksheetId: string,
  request: RangeTransferRequest,
): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/range-transfer`,
    { method: "POST", body: JSON.stringify(request) },
  ).then((body) => body.workbook);
}

/**
 * Replaces a worksheet's content (cells and rules) in one atomic write, used to
 * restore a previously persisted state for undo/redo.
 */
export function replaceWorksheetState(
  workbookId: string,
  worksheetId: string,
  state: { cells: Record<string, string>; validationRules?: ValidationRule[] },
): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/state`,
    { method: "PUT", body: JSON.stringify(state) },
  ).then((body) => body.workbook);
}

/**
 * Creates or replaces the validation rule covering one A1 range. The server
 * keeps every other rule and never touches cell values, so a rejected payload
 * leaves the worksheet unchanged.
 */
export function saveValidationRule(
  workbookId: string,
  worksheetId: string,
  rule: ValidationRule,
): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/validation-rule`,
    { method: "PUT", body: JSON.stringify(rule) },
  ).then((body) => body.workbook);
}

/** Removes the validation rule(s) covering one A1 range. */
export function deleteValidationRule(
  workbookId: string,
  worksheetId: string,
  range: string,
): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/validation-rule`,
    { method: "DELETE", body: JSON.stringify({ range }) },
  ).then((body) => body.workbook);
}

/**
 * Creates or replaces a worksheet's filter view in one atomic write. Only the
 * stored view changes: cell values, order and validation rules stay as they
 * are, so hidden rows are still part of the worksheet.
 */
export function saveFilter(
  workbookId: string,
  worksheetId: string,
  filter: WorksheetFilter,
): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/filter`,
    { method: "PUT", body: JSON.stringify({ filter }) },
  ).then((body) => body.workbook);
}

/** Removes a worksheet's filter view; every row becomes visible again. */
export function clearFilter(workbookId: string, worksheetId: string): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/filter`,
    { method: "DELETE" },
  ).then((body) => body.workbook);
}

/**
 * Saves the worksheet's currently applied filter under a workbook-unique name.
 * The name is trimmed and compared ignoring letter case, so a duplicate — like
 * an empty name or a missing applied filter — is rejected with its message and
 * nothing stored changes.
 */
export function saveFilterView(workbookId: string, worksheetId: string, name: string): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/filter-views`,
    { method: "POST", body: JSON.stringify({ worksheetId, name }) },
  ).then((body) => body.workbook);
}

/** Applies a saved filter view, replacing the worksheet's current criteria. */
export function selectFilterView(workbookId: string, worksheetId: string, name: string): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/filter-views`,
    { method: "PUT", body: JSON.stringify({ worksheetId, name }) },
  ).then((body) => body.workbook);
}

/** Deletes a saved filter view and restores every source row it filtered. */
export function deleteFilterView(workbookId: string, name: string): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/filter-views`,
    { method: "DELETE", body: JSON.stringify({ name }) },
  ).then((body) => body.workbook);
}

/**
 * Creates or replaces the note of one cell in one atomic request. Cell values,
 * formulas and the worksheet's other notes are never touched, so a rejected
 * note keeps the last stored text.
 */
export function saveCellNote(
  workbookId: string,
  worksheetId: string,
  coordinate: string,
  text: string,
): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/notes`,
    { method: "PUT", body: JSON.stringify({ coordinate, text }) },
  ).then((body) => body.workbook);
}

/**
 * Removes the note of one cell, so the grid loses its open button while the
 * cell value and every other note stay as they are.
 */
export function deleteCellNote(
  workbookId: string,
  worksheetId: string,
  coordinate: string,
): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/notes`,
    { method: "DELETE", body: JSON.stringify({ coordinate }) },
  ).then((body) => body.workbook);
}

/** Persists a worksheet's selected rectangle so it survives a refresh. */
export function selectRange(
  workbookId: string,
  worksheetId: string,
  anchor: string,
  focus: string,
): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/selection`,
    { method: "PATCH", body: JSON.stringify({ anchor, focus }) },
  ).then((body) => body.workbook);
}

/**
 * Creates a pivot table from a source range with headers. The result lives on a
 * new worksheet (first unused `PivotN` name) that becomes active; a rejected
 * request creates nothing.
 */
export function createPivotTable(
  workbookId: string,
  sourceWorksheetId: string,
  range: string,
): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(sourceWorksheetId)}/pivot`,
    { method: "POST", body: JSON.stringify({ range }) },
  ).then((body) => body.workbook);
}

/**
 * Replaces a pivot worksheet's field layout and recomputes its summary. An
 * unknown field or a value field without numbers is rejected with its message,
 * so the last successful result stays visible.
 */
export function applyPivotConfig(
  workbookId: string,
  worksheetId: string,
  config: PivotConfig,
): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/pivot`,
    { method: "PUT", body: JSON.stringify(config) },
  ).then((body) => body.workbook);
}

/** Recomputes a pivot worksheet from the current source data with its stored layout. */
export function refreshPivotTable(workbookId: string, worksheetId: string): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/pivot/refresh`,
    { method: "POST" },
  ).then((body) => body.workbook);
}

/**
 * Creates or replaces one named range of a workbook. The server requires a
 * name starting with a letter and a sheet-qualified A1 range, stores the entry
 * atomically and never touches cell values, so a rejected save keeps the last
 * stored names and formulas.
 */
export function setNamedRange(workbookId: string, name: string, range: string): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/named-ranges`,
    { method: "PUT", body: JSON.stringify({ name, range }) },
  ).then((body) => body.workbook);
}

/**
 * Appends a conditional formatting rule, or replaces the rule at `index` (the
 * 0-based position behind the dialog's "Edit rule N"). Only the stored rules
 * change: cells and formulas are never modified, so a rejection keeps the last
 * state and its fills.
 */
export function saveConditionalRule(
  workbookId: string,
  worksheetId: string,
  rule: ConditionalRule,
  index: number | null,
): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/conditional-rules`,
    {
      method: index === null ? "POST" : "PUT",
      body: JSON.stringify(index === null ? rule : { ...rule, index }),
    },
  ).then((body) => body.workbook);
}

/** Removes the conditional formatting rule at `index`; its fill disappears. */
export function deleteConditionalRule(
  workbookId: string,
  worksheetId: string,
  index: number,
): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/conditional-rules`,
    { method: "DELETE", body: JSON.stringify({ index }) },
  ).then((body) => body.workbook);
}

/**
 * Persists the frozen panes of one worksheet (the leading rows and columns
 * kept visible). Only that worksheet changes, so each sheet keeps its own
 * frozen headings across a refresh; a rejected state keeps the stored one.
 */
export function setFreeze(
  workbookId: string,
  worksheetId: string,
  freeze: WorksheetFreeze,
): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/freeze`,
    { method: "PATCH", body: JSON.stringify(freeze) },
  ).then((body) => body.workbook);
}

/** One cell written by a replacement. */
export interface CellReplacement {
  coordinate: string;
  value: string;
}

/**
 * Writes a sparse set of cells in one atomic request and reports how many were
 * written. A rejected replacement (for example one breaking a validation rule)
 * changes no cell at all, so a failed "Replace all" keeps the last state.
 */
export function replaceCells(
  workbookId: string,
  worksheetId: string,
  updates: CellReplacement[],
): Promise<{ workbook: Workbook; replaced: number }> {
  return apiRequest<{ workbook: Workbook; replaced: number }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/replace`,
    { method: "POST", body: JSON.stringify({ updates }) },
  );
}

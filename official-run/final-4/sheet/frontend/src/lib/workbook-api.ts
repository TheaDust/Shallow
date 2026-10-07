import { apiRequest } from "../lib/api";
import type {
  FrozenPanes,
  PivotConfig,
  ValidationRule,
  Workbook,
  WorkbookSummary,
  WorksheetFilter,
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
 * Saves the filter currently applied to a worksheet under a name. The server
 * trims the name, keeps it unique within the workbook and copies the applied
 * criteria, so a rejected name (an empty or duplicate one) leaves the stored
 * views untouched and reports its message.
 */
export function saveFilterView(workbookId: string, worksheetId: string, name: string): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/filter-views`,
    { method: "POST", body: JSON.stringify({ name }) },
  ).then((body) => body.workbook);
}

/** Replaces the worksheet's current filter with the criteria of a saved view. */
export function applyFilterView(workbookId: string, worksheetId: string, viewId: string): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/filter-views/apply`,
    { method: "POST", body: JSON.stringify({ id: viewId }) },
  ).then((body) => body.workbook);
}

/**
 * Deletes one saved filter view and restores every source row with it; cell
 * values, their order and the validation rules stay as they were.
 */
export function deleteFilterView(workbookId: string, worksheetId: string, viewId: string): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/filter-views`,
    { method: "DELETE", body: JSON.stringify({ id: viewId }) },
  ).then((body) => body.workbook);
}

/**
 * Stores the frozen pane counts of one worksheet (the "View" menu's freeze
 * commands). The counts are view state: no cell changes and a rejected payload
 * leaves the stored worksheet as it was.
 */
export function freezeWorksheet(
  workbookId: string,
  worksheetId: string,
  panes: FrozenPanes,
): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/freeze`,
    { method: "PUT", body: JSON.stringify(panes) },
  ).then((body) => body.workbook);
}

/**
 * Writes an explicit list of cells in one atomic request (find-and-replace).
 * Every write is validated before anything is stored, so a rejected request
 * leaves the whole worksheet unchanged.
 */
export function replaceCells(
  workbookId: string,
  worksheetId: string,
  updates: Array<{ coordinate: string; value: string }>,
): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/cells/replace`,
    { method: "POST", body: JSON.stringify({ updates }) },
  ).then((body) => body.workbook);
}

/**
 * Creates one named range, or — when `id` is given — replaces the range of the
 * stored one. The server trims the name, requires it to start with a letter and
 * keeps it unique within the workbook, so a rejected name changes nothing.
 */
export function saveNamedRange(
  workbookId: string,
  entry: { id?: string; name: string; range: string },
): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(`/api/workbooks/${encodeURIComponent(workbookId)}/named-ranges`, {
    method: entry.id ? "PUT" : "POST",
    body: JSON.stringify(entry),
  }).then((body) => body.workbook);
}

/** Removes one named range; the formulas that read it keep their text. */
export function deleteNamedRange(workbookId: string, id: string): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(`/api/workbooks/${encodeURIComponent(workbookId)}/named-ranges`, {
    method: "DELETE",
    body: JSON.stringify({ id }),
  }).then((body) => body.workbook);
}

/**
 * Creates one conditional-formatting rule, or — when `id` is given — replaces
 * the stored one. Only the stored rule changes: no cell value is written.
 */
export function saveConditionalFormat(
  workbookId: string,
  worksheetId: string,
  rule: { id?: string; range: string; condition: string; value: string; style: string },
): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/conditional-formats`,
    { method: rule.id ? "PUT" : "POST", body: JSON.stringify(rule) },
  ).then((body) => body.workbook);
}

/** Removes one conditional-formatting rule, so its fill disappears with it. */
export function deleteConditionalFormat(
  workbookId: string,
  worksheetId: string,
  id: string,
): Promise<Workbook> {
  return apiRequest<{ workbook: Workbook }>(
    `/api/workbooks/${encodeURIComponent(workbookId)}/worksheets/${encodeURIComponent(worksheetId)}/conditional-formats`,
    { method: "DELETE", body: JSON.stringify({ id }) },
  ).then((body) => body.workbook);
}

/**
 * Stores the note of one cell (a new one or the replacement of the existing
 * one). The note is kept apart from the cell value, so the grid text and every
 * formula result stay as they are; a rejected save stores nothing.
 */
export function saveNote(
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

/** Removes one cell note; the cell keeps its value and other notes stay. */
export function deleteNote(workbookId: string, worksheetId: string, coordinate: string): Promise<Workbook> {
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

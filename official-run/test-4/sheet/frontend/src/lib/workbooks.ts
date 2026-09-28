import { apiRequest } from "./api";
import type { SheetFilter } from "./filter";
import type { CellRange } from "./spreadsheet";

export interface ValidationRule {
  id: string;
  start: string;
  end: string;
  type: "dropdown" | "number";
  /** Dropdown rule: trimmed allowed values, in order. */
  allowed?: string[];
  /** Number rule: inclusive bounds. */
  min?: number;
  max?: number;
}

export interface SheetState {
  id: string;
  name: string;
  cells: Record<string, string>;
  /** Derived formula results (formula cells only); computed by the backend. */
  results: Record<string, string>;
  selectedCell: string;
  /** The complete persisted selection rectangle for this worksheet. */
  selectedRange: CellRange;
  /** Per-worksheet validation rules (REQ-5-2). */
  validationRules: ValidationRule[];
  /** Per-worksheet filter view (REQ-5-1-2); null when no filter is active. */
  filter: SheetFilter | null;
  /** Pivot configuration (REQ-5-3-1); null on ordinary worksheets. */
  pivot: PivotConfig | null;
}

export interface PivotConfig {
  /** The worksheet the source range lives on. */
  sourceSheetId: string;
  /** The source rectangle (header row + data rows). */
  sourceRange: CellRange;
  /** Selected field header texts; null before the first successful Apply. */
  rowField: string | null;
  columnField: string | null;
  valueField: string | null;
  summarizeBy: "SUM" | "COUNT" | "AVERAGE" | null;
}

export interface ClipboardState {
  sheetId: string;
  kind: "copy" | "cut";
  range: CellRange;
}

export interface Workbook {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeSheetId: string;
  sheets: SheetState[];
  /** Session undo/redo availability for the toolbar (REQ-3-2-2). */
  undoAvailable?: boolean;
  redoAvailable?: boolean;
  /** Session clipboard state (copy/cut) for range transfer (REQ-3-2-1). */
  clipboard?: ClipboardState | null;
}

export interface WorkbookSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export function listWorkbooks(): Promise<WorkbookSummary[]> {
  return apiRequest<{ workbooks: WorkbookSummary[] }>("/api/workbooks").then((body) => body.workbooks);
}

export function createWorkbook(name: string): Promise<Workbook> {
  return apiRequest<Workbook>("/api/workbooks", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function getWorkbook(id: string): Promise<Workbook> {
  return apiRequest<Workbook>(`/api/workbooks/${encodeURIComponent(id)}`);
}

export function renameWorkbook(id: string, name: string): Promise<Workbook> {
  return apiRequest<Workbook>(`/api/workbooks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export function updateCells(
  id: string,
  sheetId: string,
  updates: Record<string, string>,
): Promise<Workbook> {
  return apiRequest<Workbook>(`/api/workbooks/${encodeURIComponent(id)}/cells`, {
    method: "PATCH",
    body: JSON.stringify({ sheetId, updates }),
  });
}

export function updateState(
  id: string,
  sheetId: string,
  selectedCell: string,
  selectedRange?: CellRange,
): Promise<Workbook> {
  return apiRequest<Workbook>(`/api/workbooks/${encodeURIComponent(id)}/state`, {
    method: "PATCH",
    body: JSON.stringify({ sheetId, selectedCell, selectedRange }),
  });
}

/** Create, update, or clear (filter = null) the worksheet filter view. */
export function updateFilter(
  id: string,
  sheetId: string,
  filter: SheetFilter | null,
): Promise<Workbook> {
  return apiRequest<Workbook>(`/api/workbooks/${encodeURIComponent(id)}/filter`, {
    method: "PATCH",
    body: JSON.stringify({ sheetId, filter }),
  });
}

export interface SortPayload {
  start: string;
  end: string;
  /** Sort-column letter of the selected range, e.g. "B". */
  column: string;
  order: "ascending" | "descending";
  /** Whether the first row of the range is a header and stays put. */
  hasHeader: boolean;
}

/** Sort a rectangular range by one of its columns (REQ-5-1-1). */
export function sortRange(
  id: string,
  sheetId: string,
  payload: SortPayload,
): Promise<Workbook> {
  return apiRequest<Workbook>(`/api/workbooks/${encodeURIComponent(id)}/sort`, {
    method: "PATCH",
    body: JSON.stringify({ sheetId, ...payload }),
  });
}

export interface ValidationRulePayload {
  ruleId?: string;
  start: string;
  end: string;
  type: "dropdown" | "number";
  allowed?: string[];
  min?: number;
  max?: number;
}

/** Save (create or edit) a validation rule; returns the updated workbook. */
export function saveValidationRule(
  id: string,
  sheetId: string,
  payload: ValidationRulePayload,
): Promise<Workbook> {
  return apiRequest<Workbook>(`/api/workbooks/${encodeURIComponent(id)}/validation`, {
    method: "PATCH",
    body: JSON.stringify({ sheetId, ...payload }),
  });
}

/** Delete a validation rule; existing cell values stay unchanged. */
export function deleteValidationRule(
  id: string,
  sheetId: string,
  ruleId: string,
): Promise<Workbook> {
  return apiRequest<Workbook>(`/api/workbooks/${encodeURIComponent(id)}/validation`, {
    method: "DELETE",
    body: JSON.stringify({ sheetId, ruleId }),
  });
}

export type RowPosition = "above" | "below";
export type ColumnPosition = "left" | "right";

export function addSheet(id: string): Promise<Workbook> {
  return apiRequest<Workbook>(`/api/workbooks/${encodeURIComponent(id)}/sheets`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function renameSheet(
  id: string,
  sheetId: string,
  name: string,
): Promise<Workbook> {
  return apiRequest<Workbook>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}`,
    { method: "PATCH", body: JSON.stringify({ name }) },
  );
}

/** Delete a worksheet and activate an adjacent one (REQ-2-1-4). */
export function deleteSheet(id: string, sheetId: string): Promise<Workbook> {
  return apiRequest<Workbook>(
    `/api/workbooks/${encodeURIComponent(id)}/sheets/${encodeURIComponent(sheetId)}`,
    { method: "DELETE" },
  );
}

export function insertRow(
  id: string,
  sheetId: string,
  index: number,
  position: RowPosition,
): Promise<Workbook> {
  return apiRequest<Workbook>(`/api/workbooks/${encodeURIComponent(id)}/rows`, {
    method: "POST",
    body: JSON.stringify({ sheetId, index, position }),
  });
}

export function deleteRow(id: string, sheetId: string, index: number): Promise<Workbook> {
  return apiRequest<Workbook>(`/api/workbooks/${encodeURIComponent(id)}/rows`, {
    method: "DELETE",
    body: JSON.stringify({ sheetId, index }),
  });
}

export function insertColumn(
  id: string,
  sheetId: string,
  index: number,
  position: ColumnPosition,
): Promise<Workbook> {
  return apiRequest<Workbook>(`/api/workbooks/${encodeURIComponent(id)}/columns`, {
    method: "POST",
    body: JSON.stringify({ sheetId, index, position }),
  });
}

export function deleteColumn(
  id: string,
  sheetId: string,
  index: number,
): Promise<Workbook> {
  return apiRequest<Workbook>(`/api/workbooks/${encodeURIComponent(id)}/columns`, {
    method: "DELETE",
    body: JSON.stringify({ sheetId, index }),
  });
}

/** Create a pivot-result worksheet for the selected source range (REQ-5-3-1). */
export function createPivotTable(
  id: string,
  sheetId: string,
  range: CellRange,
): Promise<Workbook> {
  return apiRequest<Workbook>(`/api/workbooks/${encodeURIComponent(id)}/pivot`, {
    method: "POST",
    body: JSON.stringify({ sheetId, range }),
  });
}

export interface PivotConfigPayload {
  rowField: string;
  columnField: string | null;
  valueField: string;
  summarizeBy: "SUM" | "COUNT" | "AVERAGE";
}

/** Apply a field layout to the pivot sheet; the summary is recomputed. */
export function applyPivotConfig(
  id: string,
  sheetId: string,
  config: PivotConfigPayload,
): Promise<Workbook> {
  return apiRequest<Workbook>(`/api/workbooks/${encodeURIComponent(id)}/pivot`, {
    method: "PATCH",
    body: JSON.stringify({ sheetId, config }),
  });
}

/** Recompute the pivot summary with the stored configuration. */
export function refreshPivot(id: string, sheetId: string): Promise<Workbook> {
  return apiRequest<Workbook>(
    `/api/workbooks/${encodeURIComponent(id)}/pivot/refresh`,
    { method: "POST", body: JSON.stringify({ sheetId }) },
  );
}

export function importCsv(fileName: string, content: string): Promise<Workbook> {
  return apiRequest<Workbook>("/api/import-csv", {
    method: "POST",
    body: JSON.stringify({ fileName, content }),
  });
}

export type ClipboardKind = "copy" | "cut";

export function captureClipboard(
  id: string,
  sheetId: string,
  kind: ClipboardKind,
  range: CellRange,
): Promise<Workbook> {
  return apiRequest<Workbook>(`/api/workbooks/${encodeURIComponent(id)}/clipboard`, {
    method: "POST",
    body: JSON.stringify({ sheetId, kind, range }),
  });
}

export function pasteClipboard(id: string, sheetId: string, target: string): Promise<Workbook> {
  return apiRequest<Workbook>(`/api/workbooks/${encodeURIComponent(id)}/paste`, {
    method: "POST",
    body: JSON.stringify({ sheetId, target }),
  });
}

export function undoWorkbook(id: string): Promise<Workbook> {
  return apiRequest<Workbook>(`/api/workbooks/${encodeURIComponent(id)}/undo`, {
    method: "POST",
  });
}

export function redoWorkbook(id: string): Promise<Workbook> {
  return apiRequest<Workbook>(`/api/workbooks/${encodeURIComponent(id)}/redo`, {
    method: "POST",
  });
}

export function exportCsvUrl(id: string): string {
  return `/api/workbooks/${encodeURIComponent(id)}/export-csv`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

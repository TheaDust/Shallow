import { SHEET_COLUMN_COUNT, SHEET_ROW_COUNT } from "./spreadsheet";

export interface CellSelectionState {
  start: string;
  end: string;
}

/** Conditions one filtered column can use, mirroring `backend/src/domain/filter.mjs`. */
export type FilterCondition =
  | "text-contains"
  | "greater-than"
  | "before"
  | "is-empty"
  | "is-not-empty";

/**
 * One filtered column of a filter view: either the set of values to keep visible or a
 * condition with its operand.
 */
export interface ColumnFilter {
  column: string;
  mode: "values" | "condition";
  values?: string[];
  condition?: FilterCondition;
  value?: string;
}

/**
 * Filter view of a worksheet: `range` is the data region with its header row, `columns` the
 * per-column filters that are combined with AND. Rows are never changed, only hidden.
 */
export interface WorksheetFilter {
  range: string;
  columns: ColumnFilter[];
}

/** Summarization methods a pivot table offers, mirroring `backend/src/domain/pivot.mjs`. */
export type PivotMethod = "SUM" | "COUNT" | "AVERAGE";

/**
 * Pivot table of one worksheet: the source worksheet and range it reads, the chosen fields
 * (identified by their header text) and the method. The summary is stored in the pivot
 * worksheet's own `cells`, so a source change never alters it before an explicit refresh.
 */
export interface PivotConfig {
  sourceSheetId: string;
  sourceRange: string;
  rowField: string;
  columnField: string;
  valueField: string;
  method: PivotMethod;
}

/**
 * One data-validation rule of a worksheet, mirroring `backend/src/domain/validation.mjs`:
 * a `range` the rule covers, a `type` and its parameters, plus an optional own `message`.
 */
export interface ValidationRule {
  id: string;
  range: string;
  type: "number-range" | "dropdown";
  min?: number;
  max?: number;
  values?: string[];
  message?: string;
}

export interface WorksheetState {
  id: string;
  name: string;
  cells: Record<string, string>;
  /**
   * Display text of every non-empty cell, computed by the server: ordinary cells keep
   * their submitted text, formula cells hold their calculated result or error value.
   */
  values?: Record<string, string>;
  /** Rectangle of the most recent successful selection of this worksheet. */
  selection?: CellSelectionState;
  /** Data-validation rules covering this worksheet, persisted with the workbook. */
  validations?: ValidationRule[];
  /** Filter view of this worksheet, persisted with the workbook. */
  filter?: WorksheetFilter;
  /** Present when this worksheet holds a pivot table (REQ-5-3). */
  pivot?: PivotConfig;
  /**
   * 1-based row numbers the stored filter hides, derived by the server on every response.
   * Hidden rows keep their cells and values; they are only left out of the grid.
   */
  hiddenRows?: number[];
  /** Grid height; insertion grows it so shifted rows are never dropped. Defaults to 50. */
  rowCount?: number;
  /** Grid width; insertion grows it so shifted columns are never dropped. Defaults to 26. */
  columnCount?: number;
}

export interface WorkbookSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export interface WorkbookState extends WorkbookSummary {
  createdAt: string;
  activeSheetId: string;
  sheets: WorksheetState[];
}

/**
 * Contract messages of the worksheet lifecycle, mirroring
 * `backend/src/domain/worksheets.mjs` so the client can refuse a delete it already knows the
 * server would refuse.
 */
export const WORKSHEET_LAST_REMAINING_MESSAGE =
  "A workbook must contain at least one worksheet";
export const WORKSHEET_PIVOT_DEPENDENCY_MESSAGE =
  "Please delete or rebuild dependent pivot tables first";

/** Raw cell text: what the formula bar shows and what an edit submits. */
export function cellInput(sheet: WorksheetState | undefined, address: string): string {
  if (!sheet) return "";
  return sheet.cells[address.toUpperCase()] ?? "";
}

/** Displayed cell text: the calculated result of a formula, otherwise the submitted text. */
export function cellText(sheet: WorksheetState | undefined, address: string): string {
  if (!sheet) return "";
  const key = address.toUpperCase();
  return sheet.values?.[key] ?? sheet.cells[key] ?? "";
}

/** Grid height of a worksheet, falling back to the default grid size. */
export function rowCount(sheet: WorksheetState | undefined): number {
  const value = sheet?.rowCount;
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : SHEET_ROW_COUNT;
}

/** Grid width of a worksheet, falling back to the default grid size. */
export function columnCount(sheet: WorksheetState | undefined): number {
  const value = sheet?.columnCount;
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : SHEET_COLUMN_COUNT;
}

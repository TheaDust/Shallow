export interface CellData {
  value: string;
  formula?: string | null;
}

/** One data-validation rule bound to a rectangle of the worksheet. */
export interface ValidationRule {
  range: string;
  type: "number" | "list";
  min?: number;
  max?: number;
  values?: string[];
  message?: string;
}

export interface Selection {
  anchor: string;
  focus: string;
}

/** Conditions offered by one column of a filter view (REQ-5-1-2). */
export type FilterCondition =
  | "text-contains"
  | "greater-than"
  | "before"
  | "is-empty"
  | "is-not-empty";

export interface FilterRule {
  /** 0-based worksheet column the rule reads. */
  column: number;
  mode: "values" | "condition";
  values?: string[];
  condition?: FilterCondition;
  value?: string;
}

/** A filter view: a data region with headers plus one optional rule per column. */
export interface WorksheetFilter {
  range: string;
  rules: FilterRule[];
}

/** Summarization methods offered by the "Summarize by" combo box (REQ-5-3-1). */
export type PivotMethod = "SUM" | "COUNT" | "AVERAGE";

/** Configuration of one pivot-result worksheet; fields are source header texts. */
export interface PivotSpec {
  sourceWorksheetId: string;
  sourceRange: string;
  rowField: string | null;
  columnField: string | null;
  valueField: string | null;
  summarizeBy: PivotMethod;
}

export interface Worksheet {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  cells: Record<string, CellData>;
  selection: Selection;
  validations?: ValidationRule[];
  filter?: WorksheetFilter;
  /** Set on a pivot-result worksheet; its cells hold the last successful summary. */
  pivot?: PivotSpec;
}

export interface Workbook {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeWorksheetId: string;
  worksheets: Worksheet[];
}

export interface WorkbookSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export interface CellPosition {
  row: number;
  column: number;
}

/** One submitted cell value: the raw text typed or pasted by the user. */
export interface CellInput {
  name: string;
  input: string;
}

export type StructureAxis = "row" | "column";

export type StructureAction =
  | "insert-above"
  | "insert-below"
  | "insert-left"
  | "insert-right"
  | "delete";

export interface StructureCommand {
  axis: StructureAxis;
  action: StructureAction;
  /** 0-based coordinate of the target row or column. */
  index: number;
}

const COLUMN_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** 0-based column index to spreadsheet label: 0 -> A, 25 -> Z, 26 -> AA. */
export function columnLabel(column: number): string {
  let index = column;
  let label = "";
  do {
    label = COLUMN_LETTERS[index % 26] + label;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);
  return label;
}

/** 0-based row/column to a cell coordinate such as `A1`. */
export function cellName(row: number, column: number): string {
  return `${columnLabel(column)}${row + 1}`;
}

/** Parses a cell coordinate such as `A1` into 0-based row/column, or null when invalid. */
export function parseCellName(name: string): CellPosition | null {
  const match = /^([A-Za-z]+)([1-9][0-9]*)$/.exec(name.trim());
  if (!match) return null;
  let column = 0;
  for (const character of match[1].toUpperCase()) {
    column = column * 26 + (character.charCodeAt(0) - 64);
  }
  return { row: Number(match[2]) - 1, column: column - 1 };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Deterministic timestamp text shared by the home page and the editor. */
export function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  return `${day} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

export function lastUpdatedText(updatedAt: string): string {
  return `Last updated: ${formatTimestamp(updatedAt)}`;
}

export function selectionBounds(selection: Selection): { top: number; left: number; bottom: number; right: number } | null {
  const anchor = parseCellName(selection.anchor);
  const focus = parseCellName(selection.focus);
  if (!anchor || !focus) return null;
  return {
    top: Math.min(anchor.row, focus.row),
    left: Math.min(anchor.column, focus.column),
    bottom: Math.max(anchor.row, focus.row),
    right: Math.max(anchor.column, focus.column),
  };
}

export function isCellInSelection(selection: Selection, row: number, column: number): boolean {
  const bounds = selectionBounds(selection);
  if (!bounds) return false;
  return row >= bounds.top && row <= bounds.bottom && column >= bounds.left && column <= bounds.right;
}

/** Canonical `A1:C6` text of a selection rectangle; used as a filter or rule range. */
export function selectionRangeName(selection: Selection): string {
  const bounds = selectionBounds(selection);
  if (!bounds) return "A1";
  return `${cellName(bounds.top, bounds.left)}:${cellName(bounds.bottom, bounds.right)}`;
}

/** Top-left coordinate of a selection rectangle; used as the paste target. */
export function selectionTopLeft(selection: Selection): string {
  const bounds = selectionBounds(selection);
  return bounds ? cellName(bounds.top, bounds.left) : "A1";
}

/** Number of rows and columns covered by a selection rectangle. */
export function selectionSize(selection: Selection): { rows: number; columns: number } | null {
  const bounds = selectionBounds(selection);
  if (!bounds) return null;
  return { rows: bounds.bottom - bounds.top + 1, columns: bounds.right - bounds.left + 1 };
}

/** Immutable snapshot of one worksheet used to restore state for undo/redo. */
export interface WorksheetSnapshot {
  rowCount: number;
  columnCount: number;
  cells: Record<string, CellData>;
  selection: Selection;
  validations?: ValidationRule[];
}

export function snapshotWorksheet(worksheet: Worksheet): WorksheetSnapshot {
  return {
    rowCount: worksheet.rowCount,
    columnCount: worksheet.columnCount,
    cells: structuredClone(worksheet.cells ?? {}),
    selection: { anchor: worksheet.selection.anchor, focus: worksheet.selection.focus },
    ...(worksheet.validations ? { validations: structuredClone(worksheet.validations) } : {}),
  };
}

export function activeCellName(worksheet: Worksheet): string {
  return worksheet.selection?.focus ?? "A1";
}

/** Text the user submitted for a cell: the original formula when set, otherwise the value. */
export function cellInputText(worksheet: Worksheet, name: string): string {
  const cell = worksheet.cells[name];
  return cell?.formula ?? cell?.value ?? "";
}

export function sameSelection(left: Selection | null | undefined, right: Selection | null | undefined): boolean {
  return Boolean(left && right && left.anchor === right.anchor && left.focus === right.focus);
}

/** Displayed text of a cell: the calculated value for formula cells, otherwise the plain value. */
export function cellDisplayText(worksheet: Worksheet, name: string): string {
  return worksheet.cells[name]?.value ?? "";
}

export function selectedCellText(worksheet: Worksheet): string {
  return cellDisplayText(worksheet, activeCellName(worksheet));
}

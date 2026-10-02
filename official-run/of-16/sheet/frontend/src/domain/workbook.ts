export interface CellRef {
  row: number;
  col: number;
}

export interface CellRegion {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

/** Cell validation rule of one worksheet; `range` is an A1 rectangle. */
export interface ValidationRule {
  range: string;
  /** `list` = dropdown with `values`; the number types use `min`/`max`. */
  type: "number" | "number-between" | "list";
  min?: number;
  max?: number;
  /** Allowed values of a `list` rule, already trimmed of surrounding spaces. */
  values?: string[];
  message?: string;
  allowBlank?: boolean;
}

/** Filter condition of one column (REQ-5-1-2); the visible names are in `FILTER_CONDITIONS`. */
export type FilterCondition =
  | "text-contains"
  | "greater-than"
  | "before"
  | "is-empty"
  | "is-not-empty";

/**
 * One constrained column of a filter. A `values` rule keeps the rows whose
 * displayed value is in `values`; a `condition` rule keeps the rows that satisfy
 * `condition` (with `value` for the conditions that compare against one).
 */
export interface FilterRule {
  /** Header text of the column inside the filtered range. */
  header: string;
  type: "values" | "condition";
  values?: string[];
  condition?: FilterCondition;
  value?: string;
}

/**
 * Persisted filter view of one worksheet: the data region (first row = headers)
 * plus one rule per constrained column. Hiding is a view concern only — the
 * stored values, their order and the used rectangle never change.
 */
export interface WorksheetFilter {
  range: string;
  rules: FilterRule[];
}

/** Summarization methods of a pivot table (REQ-5-3-1); the visible names match. */
export type PivotSummarize = "SUM" | "COUNT" | "AVERAGE";

/**
 * Stored configuration of one pivot-result worksheet: the source worksheet and
 * range it reads plus the chosen fields. The computed summary itself lives in
 * the worksheet's own `cells`, so the source worksheet is never written.
 */
export interface PivotTable {
  sourceWorksheetId: string;
  sourceRange: string;
  rowField: string;
  /** Column field; `""` means "no column field". */
  columnField: string;
  valueField: string;
  summarizeBy: PivotSummarize;
}

/** Fields submitted by the "Pivot table editor" (Apply / Refresh). */
export interface PivotFields {
  rowField: string;
  columnField: string;
  valueField: string;
  summarizeBy: PivotSummarize;
}

export interface Worksheet {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  /** Used rectangle (counts) that CSV export writes out; may exceed the non-empty cells. */
  usedRows?: number;
  usedCols?: number;
  cells: Record<string, string>;
  /** Validation rules enforced on writes; absent when the worksheet has none. */
  validations?: ValidationRule[];
  /** Filter view hiding rows; absent when the worksheet has no filter. */
  filter?: WorksheetFilter;
  /** Pivot configuration; present only on a pivot-result worksheet (REQ-5-3-1). */
  pivot?: PivotTable;
}

export interface Workbook {
  id: string;
  name: string;
  updatedAt: string;
  activeWorksheetId: string;
  worksheets: Worksheet[];
  /** Per-worksheet selection; newer data stores the full rectangle. */
  selections: Record<string, StoredSelection>;
}

export interface WorkbookSummary {
  id: string;
  name: string;
  updatedAt: string;
  worksheetCount: number;
}

export interface Selection {
  anchor: CellRef;
  focus: CellRef;
}

/**
 * Persisted selection of one worksheet (REQ-3-1-3): the complete rectangle, not
 * just the top-left corner. `CellRef` is the legacy top-left-only shape, still
 * accepted when reading data written before the rectangle was stored.
 */
export type StoredSelection = { anchor: CellRef; focus: CellRef } | CellRef;

/** Row-number menu commands of the current worksheet (REQ-2-2-1). */
export type RowStructureAction = "insert-above" | "insert-below" | "delete";

/** Column-header menu commands of the current worksheet (REQ-2-2-2). */
export type ColumnStructureAction = "insert-left" | "insert-right" | "delete";

export type StructureAxis = "row" | "column";
export type StructureAction = RowStructureAction | ColumnStructureAction;

export const ORIGIN: CellRef = { row: 0, col: 0 };

export function columnLabel(col: number): string {
  let label = "";
  let value = col;
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

export function cellName(ref: CellRef): string {
  return `${columnLabel(ref.col)}${ref.row + 1}`;
}

export function parseCellName(name: string): CellRef | null {
  const match = /^([A-Z]{1,3})([1-9][0-9]*)$/.exec(String(name ?? "").trim().toUpperCase());
  if (!match) return null;
  let col = 0;
  for (const character of match[1]) col = col * 26 + (character.charCodeAt(0) - 64);
  return { row: Number(match[2]) - 1, col: col - 1 };
}

export function clampCell(ref: CellRef, rowCount: number, columnCount: number): CellRef {
  return {
    row: Math.min(Math.max(ref.row, 0), Math.max(rowCount - 1, 0)),
    col: Math.min(Math.max(ref.col, 0), Math.max(columnCount - 1, 0)),
  };
}

export function selectionRegion(selection: Selection): CellRegion {
  return {
    minRow: Math.min(selection.anchor.row, selection.focus.row),
    maxRow: Math.max(selection.anchor.row, selection.focus.row),
    minCol: Math.min(selection.anchor.col, selection.focus.col),
    maxCol: Math.max(selection.anchor.col, selection.focus.col),
  };
}

export function isWithinRegion(ref: CellRef, region: CellRegion): boolean {
  return ref.row >= region.minRow && ref.row <= region.maxRow
    && ref.col >= region.minCol && ref.col <= region.maxCol;
}

export function workbookRoute(id: string): string {
  return `/workbooks/${encodeURIComponent(id)}`;
}

/**
 * Opaque, client-chosen workbook id used when the browser starts a creation:
 * the editor page can be entered before the create request finishes and a
 * repeated request for the same id stays idempotent.
 */
export function newWorkbookId(name: string): string {
  const slug = String(name ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  return `${slug || "workbook"}-${suffix}`.slice(0, 64);
}

export function activeWorksheet(workbook: Workbook): Worksheet {
  return workbook.worksheets.find((worksheet) => worksheet.id === workbook.activeWorksheetId)
    ?? workbook.worksheets[0];
}

/** True for the rectangle shape; the legacy top-left-only shape has no anchor. */
function isRectangleSelection(value: StoredSelection): value is { anchor: CellRef; focus: CellRef } {
  return Boolean(value) && "anchor" in value && "focus" in value;
}

export function selectionFor(workbook: Workbook, worksheetId: string): Selection {
  const stored = workbook.selections?.[worksheetId];
  if (!stored) return { anchor: { ...ORIGIN }, focus: { ...ORIGIN } };
  if (isRectangleSelection(stored)) {
    return { anchor: { ...stored.anchor }, focus: { ...stored.focus } };
  }
  return { anchor: { ...stored }, focus: { ...stored } };
}

/** Same rectangle? Used to skip redundant selection writes. */
export function sameSelection(left: Selection, right: Selection): boolean {
  return left.anchor.row === right.anchor.row && left.anchor.col === right.anchor.col
    && left.focus.row === right.focus.row && left.focus.col === right.focus.col;
}

/** Persisted rectangle payload for the state endpoint. */
export function storedSelection(selection: Selection): { anchor: CellRef; focus: CellRef } {
  return {
    anchor: { row: selection.anchor.row, col: selection.anchor.col },
    focus: { row: selection.focus.row, col: selection.focus.col },
  };
}

export function formatLastUpdated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} `
    + `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

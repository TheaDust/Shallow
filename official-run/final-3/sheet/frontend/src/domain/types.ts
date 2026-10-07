/** Domain types shared by the workbook home page and the workbook editor. */

/** A worksheet selection: the anchor cell and the focus cell of its rectangle. */
export interface WorksheetSelection {
  anchor: string;
  focus: string;
}

/**
 * Frozen panes of a worksheet: every row through `rows` and every column
 * through `columns` stay in place while the sheet scrolls. Zero means the axis
 * is not frozen, so `{ rows: 0, columns: 0 }` is the unfrozen state.
 */
export interface WorksheetFreeze {
  rows: number;
  columns: number;
}

/** A data-validation rule covering an A1 range (enforced by the server). */
export interface ValidationRule {
  range: string;
  type: string;
  min?: number;
  max?: number;
  values?: string[];
  /** Optional rejection message; empty means the standard wording. */
  errorMessage?: string;
}

/**
 * A workbook-level named range: a name usable as a range reference in formulas,
 * bound to an A1 area of one worksheet. The worksheet is kept by stable id, so
 * renaming the worksheet does not break the name; its display text is derived
 * from the worksheet's current name.
 */
export interface NamedRange {
  name: string;
  worksheetId: string;
  range: string;
}

/** Condition kinds a conditional formatting rule may use. */
export type FormatCondition = "greater-than" | "text-contains";

/** Fill style a matching cell shows; each maps to one visible background. */
export type FillStyle = "red" | "yellow" | "green";

/**
 * One conditional formatting rule of a worksheet: the target A1 range, the
 * condition a cell has to satisfy, and the fill a matching cell shows. Rules
 * only describe a fill and never change stored cell text.
 */
export interface FormatRule {
  range: string;
  condition: FormatCondition;
  value: string;
  style: FillStyle;
}

/** Names of the condition options offered by a filter dialog. */
export type FilterConditionName =
  | "Text contains"
  | "Greater than"
  | "Before"
  | "Is empty"
  | "Is not empty";

/**
 * One column of a filter view: either a set of accepted source values or a
 * single condition. Both only decide which rows stay visible.
 */
export interface FilterColumn {
  /** Absolute 1-based column of the header cell inside the filtered range. */
  column: number;
  /** Display text of the header cell, also the dialog name suffix. */
  header: string;
  mode: "values" | "condition";
  /** Accepted source values (`mode: "values"`); empty means unconstrained. */
  values?: string[];
  condition?: FilterConditionName;
  value?: string;
}

/** A filter view over a rectangular region whose first row holds the headers. */
export interface WorksheetFilter {
  /** A1 area of the filtered region, header row included. */
  range: string;
  columns: FilterColumn[];
}

/**
 * One saved filter view of a worksheet: the criteria of a filter that was
 * applied earlier. Applying a view replaces the worksheet's current filter.
 */
export interface FilterView {
  /** Trimmed name, unique within the workbook. */
  name: string;
  /** Stored criteria, never modified by applying or deleting the view. */
  filter: WorksheetFilter;
}

/** Summarization methods offered by the pivot editor. */
export type SummarizeMethod = "SUM" | "COUNT" | "AVERAGE";

/** Field layout of a pivot table: one row field, an optional column field, one value field. */
export interface PivotConfig {
  /** Source header text grouping the rows. */
  rowField: string;
  /** Source header text spreading the columns; an empty string means none. */
  columnField: string;
  /** Source header text aggregated in each cell. */
  valueField: string;
  summarizeBy: SummarizeMethod;
}

/** A pivot table stored on its own result worksheet. */
export interface WorksheetPivot extends PivotConfig {
  /** Worksheet the pivot reads; never modified by an apply or refresh. */
  sourceWorksheetId: string;
  /** A1 area of the source worksheet, header row included. */
  range: string;
}

export interface Worksheet {
  id: string;
  name: string;
  /** Raw cell text keyed by coordinate (for example `A1`). */
  cells: Record<string, string>;
  /** Data-validation rules for this worksheet; absent means none. */
  validationRules?: ValidationRule[];
  /** Filter view of this worksheet; absent means every row is visible. */
  filter?: WorksheetFilter | null;
  /** Saved filter views of this worksheet; absent means none was saved. */
  filterViews?: FilterView[];
  /** Pivot table stored on this worksheet; absent means it is a plain worksheet. */
  pivot?: WorksheetPivot | null;
  /** Conditional formatting rules of this worksheet; absent means none. */
  formatRules?: FormatRule[];
  /**
   * Cell notes keyed by coordinate; absent means no cell is annotated. A note
   * only annotates its cell: it never changes the stored cell text.
   */
  notes?: Record<string, string>;
  /** Most recent successfully persisted selection; absent means A1. */
  selection?: WorksheetSelection;
  /** Frozen panes of this worksheet; absent means nothing is frozen. */
  freeze?: WorksheetFreeze | null;
}

export interface Workbook {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeWorksheetId: string;
  worksheets: Worksheet[];
  /** Named ranges of the whole workbook; absent means none is saved. */
  namedRanges?: NamedRange[];
}

export interface WorkbookSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeWorksheetId: string;
  worksheetCount: number;
}

export const EMPTY_WORKBOOK_NAME_MESSAGE = "Workbook name cannot be empty";
export const EMPTY_WORKSHEET_NAME_MESSAGE = "Worksheet name cannot be empty";
export const DUPLICATE_WORKSHEET_NAME_MESSAGE = "Worksheet name already exists";
export const LONG_WORKSHEET_NAME_MESSAGE = "Worksheet name must be 50 characters or fewer";
/** Longest accepted worksheet name, counted after trimming. */
export const MAX_WORKSHEET_NAME_LENGTH = 50;
export const LAST_WORKSHEET_MESSAGE = "A workbook must contain at least one worksheet";
export const PIVOT_SOURCE_DEPENDENCY_MESSAGE = "Please delete or rebuild dependent pivot tables first";

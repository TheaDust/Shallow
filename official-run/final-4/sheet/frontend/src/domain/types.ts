/** Domain types shared by the workbook home page and the workbook editor. */

/** Frozen pane counts of a worksheet: headings that stay put while scrolling. */
export interface FrozenPanes {
  /** Number of frozen rows counted from row 1. */
  rows: number;
  /** Number of frozen columns counted from column A. */
  columns: number;
}

/** A worksheet selection: the anchor cell and the focus cell of its rectangle. */
export interface WorksheetSelection {
  anchor: string;
  focus: string;
}

/** A data-validation rule covering an A1 range (enforced by the server). */
export interface ValidationRule {
  range: string;
  type: string;
  min?: number;
  max?: number;
  values?: string[];
  /** Custom rejection text replacing the standard message when nonempty. */
  errorMessage?: string;
}

/**
 * A workbook-scoped name standing for an A1 area of one worksheet. `range`
 * keeps an optional `Sheet!` qualifier, so a rename or a second worksheet never
 * changes the cells a saved name reads.
 */
export interface NamedRange {
  id: string;
  name: string;
  range: string;
}

/** Condition names of the conditional-formatting "Condition" field. */
export type ConditionalFormatCondition = "Greater than" | "Text contains";

/** Style names of the conditional-formatting "Style" field. */
export type ConditionalFormatStyle = "Red fill" | "Yellow fill" | "Green fill";

/**
 * A conditional-formatting rule: the A1 area it covers, the condition and value
 * a cell is compared against, and the fill style a matching cell shows. A rule
 * never changes a cell value, it only decides the visible fill.
 */
export interface ConditionalFormat {
  id: string;
  range: string;
  condition: ConditionalFormatCondition;
  value: string;
  style: ConditionalFormatStyle;
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
 * A named, saved filter view of one worksheet. Its criteria are the range and
 * column rules of the filter that was applied when it was saved; applying it
 * replaces the worksheet's current filter without changing the saved copy.
 */
export interface WorksheetFilterView extends WorksheetFilter {
  id: string;
  name: string;
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
  filterViews?: WorksheetFilterView[];
  /** Conditional-formatting rules of this worksheet; absent means no fill. */
  conditionalFormats?: ConditionalFormat[];
  /** Cell notes keyed by A1 coordinate; absent means no cell carries a note. */
  notes?: Record<string, string>;
  /** Pivot table stored on this worksheet; absent means it is a plain worksheet. */
  pivot?: WorksheetPivot | null;
  /** Most recent successfully persisted selection; absent means A1. */
  selection?: WorksheetSelection;
  /** Frozen rows/columns of this worksheet; absent means nothing is frozen. */
  frozen?: FrozenPanes | null;
}

export interface Workbook {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeWorksheetId: string;
  worksheets: Worksheet[];
  /** Named ranges of the whole workbook; absent means none was saved. */
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

/** Longest workbook name accepted after trimming (mirrors the server rule). */
export const WORKBOOK_NAME_MAX_LENGTH = 80;
export const EMPTY_WORKBOOK_NAME_MESSAGE = "Workbook name cannot be empty";
export const LONG_WORKBOOK_NAME_MESSAGE = "Workbook name must be 80 characters or fewer";
export const DUPLICATE_WORKBOOK_NAME_MESSAGE = "Workbook name already exists";
/** Longest worksheet name accepted after trimming (mirrors the server rule). */
export const WORKSHEET_NAME_MAX_LENGTH = 50;
export const EMPTY_WORKSHEET_NAME_MESSAGE = "Worksheet name cannot be empty";
export const LONG_WORKSHEET_NAME_MESSAGE = "Worksheet name must be 50 characters or fewer";
export const DUPLICATE_WORKSHEET_NAME_MESSAGE = "Worksheet name already exists";
export const LAST_WORKSHEET_MESSAGE = "A workbook must contain at least one worksheet";
export const PIVOT_SOURCE_DEPENDENCY_MESSAGE = "Please delete or rebuild dependent pivot tables first";
/** Exact rejection text of a named range whose name does not start with a letter. */
export const NAMED_RANGE_NAME_MESSAGE = "Named range must start with a letter";

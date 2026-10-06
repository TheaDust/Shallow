/** Domain types shared by the workbook home page and the workbook editor. */

/** A worksheet selection: the anchor cell and the focus cell of its rectangle. */
export interface WorksheetSelection {
  anchor: string;
  focus: string;
}

/**
 * Frozen panes of one worksheet: how many rows stay above and how many columns
 * stay left of the scrolling area. `{ rows: 0, columns: 0 }` means unfrozen.
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
  /**
   * Optional rejection message replacing the standard one for this rule. It is
   * absent while the dialog's "Error message" field is empty.
   */
  message?: string;
}

/**
 * A named range of one workbook: a name usable inside formulas as a range
 * reference, and its A1 area (optionally qualified with `Sheet!`).
 */
export interface NamedRange {
  id: string;
  name: string;
  range: string;
}

/** Condition options offered by the "Condition" field of a formatting rule. */
export type ConditionalFormatCondition = "Greater than" | "Text contains";

/** Fill styles offered by the "Style" field; the name is the stored value. */
export type ConditionalFormatStyle = "Red fill" | "Yellow fill" | "Green fill";

/** One conditional formatting rule of a worksheet. */
export interface ConditionalFormatRule {
  id: string;
  /** A1 area the rule watches, header row excluded or included as selected. */
  range: string;
  condition: ConditionalFormatCondition;
  /** Required comparison value; for "Greater than" a parseable number. */
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
 * A named filter view of one workbook. The stored criteria are applied to the
 * active worksheet when the view is chosen; the name is unique inside the
 * workbook and is what the view-management interface lists.
 */
export interface FilterView {
  id: string;
  name: string;
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
  /** Cell notes keyed by coordinate; absent means no cell carries a note. */
  notes?: Record<string, string>;
  /** Data-validation rules for this worksheet; absent means none. */
  validationRules?: ValidationRule[];
  /** Filter view of this worksheet; absent means every row is visible. */
  filter?: WorksheetFilter | null;
  /** Pivot table stored on this worksheet; absent means it is a plain worksheet. */
  pivot?: WorksheetPivot | null;
  /** Conditional formatting rules of this worksheet; absent means none. */
  conditionalFormats?: ConditionalFormatRule[];
  /** Most recent successfully persisted selection; absent means A1. */
  selection?: WorksheetSelection;
  /** Frozen panes of this worksheet; absent means nothing is frozen. */
  freeze?: WorksheetFreeze;
}

export interface Workbook {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeWorksheetId: string;
  worksheets: Worksheet[];
  /** Filter views saved in this workbook; absent means none was saved yet. */
  filterViews?: FilterView[];
  /** Named ranges saved in this workbook; absent means none was saved yet. */
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
/** Longest accepted worksheet name, measured after trimming; mirrors the backend. */
export const WORKSHEET_NAME_MAX_LENGTH = 50;
export const LONG_WORKSHEET_NAME_MESSAGE = "Worksheet name must be 50 characters or fewer";
export const LAST_WORKSHEET_MESSAGE = "A workbook must contain at least one worksheet";
export const PIVOT_SOURCE_DEPENDENCY_MESSAGE = "Please delete or rebuild dependent pivot tables first";

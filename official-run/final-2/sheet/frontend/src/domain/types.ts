/** Domain types shared by the workbook home page and the workbook editor. */

/** A worksheet selection: the anchor cell and the focus cell of its rectangle. */
export interface WorksheetSelection {
  anchor: string;
  focus: string;
}

/**
 * Frozen pane state of a worksheet: how many leading rows and columns stay
 * visible while the rest of the sheet scrolls.
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
  /** Replaces the standard rejection text of this rule when nonempty. */
  errorMessage?: string;
}

/**
 * Name of a workbook range: the formula-visible name plus the sheet-qualified
 * A1 area it refers to (for example `ForecastModel!J3:J5`).
 */
export interface NamedRange {
  name: string;
  range: string;
}

/** Names of the condition options offered by the conditional formatting dialog. */
export const GREATER_THAN_CONDITION = "greater-than";
export const TEXT_CONTAINS_CONDITION = "text-contains";
export type ConditionalCondition = typeof GREATER_THAN_CONDITION | typeof TEXT_CONTAINS_CONDITION;

/** Names of the fill styles offered by the conditional formatting dialog. */
export const RED_FILL_STYLE = "red-fill";
export const YELLOW_FILL_STYLE = "yellow-fill";
export const GREEN_FILL_STYLE = "green-fill";
export type ConditionalStyle =
  | typeof RED_FILL_STYLE
  | typeof YELLOW_FILL_STYLE
  | typeof GREEN_FILL_STYLE;

/** A conditional formatting rule covering an A1 range of one worksheet. */
export interface ConditionalRule {
  /** A1 area of the worksheet the rule paints. */
  range: string;
  condition: ConditionalCondition;
  /** Required comparison text (a threshold or the sought text). */
  value: string;
  style: ConditionalStyle;
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
 * Named copy of a filter, saved on the workbook so the same restriction can be
 * chosen again. The name is unique within the workbook ignoring letter case.
 */
export interface SavedFilterView {
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

/**
 * Annotation text of one cell, keyed by its A1 coordinate. A cell without an
 * entry has no note; the grid shows an "Open note for <coordinate>" button for
 * every entry.
 */
export type WorksheetNotes = Record<string, string>;

export interface Worksheet {
  id: string;
  name: string;
  /** Raw cell text keyed by coordinate (for example `A1`). */
  cells: Record<string, string>;
  /** Cell notes of this worksheet keyed by coordinate; absent means none. */
  notes?: WorksheetNotes;
  /** Data-validation rules for this worksheet; absent means none. */
  validationRules?: ValidationRule[];
  /** Conditional formatting rules of this worksheet; absent means none. */
  conditionalRules?: ConditionalRule[];
  /** Filter view of this worksheet; absent means every row is visible. */
  filter?: WorksheetFilter | null;
  /** Name of the saved filter view this worksheet's filter was applied from. */
  filterViewName?: string;
  /** Pivot table stored on this worksheet; absent means it is a plain worksheet. */
  pivot?: WorksheetPivot | null;
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
  /** Saved filter views of this workbook; absent means none were saved. */
  filterViews?: SavedFilterView[];
  /** Named ranges of this workbook; absent means none were saved. */
  namedRanges?: NamedRange[];
  worksheets: Worksheet[];
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
export const LONG_WORKBOOK_NAME_MESSAGE = "Workbook name must be 80 characters or fewer";
export const MAX_WORKBOOK_NAME_LENGTH = 80;
export const EMPTY_WORKSHEET_NAME_MESSAGE = "Worksheet name cannot be empty";
export const DUPLICATE_WORKSHEET_NAME_MESSAGE = "Worksheet name already exists";
export const LONG_WORKSHEET_NAME_MESSAGE = "Worksheet name must be 50 characters or fewer";
export const MAX_WORKSHEET_NAME_LENGTH = 50;
export const LAST_WORKSHEET_MESSAGE = "A workbook must contain at least one worksheet";
export const PIVOT_SOURCE_DEPENDENCY_MESSAGE = "Please delete or rebuild dependent pivot tables first";
export const EMPTY_FILTER_VIEW_NAME_MESSAGE = "Filter view name cannot be empty";
export const FILTER_VIEW_DUPLICATE_MESSAGE = "Filter view name already exists";
export const FILTER_VIEW_NO_FILTER_MESSAGE = "Create a filter before saving a filter view";
export const EMPTY_NOTE_MESSAGE = "Note cannot be empty";

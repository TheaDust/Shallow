/** Domain types shared by the workbook home page and the workbook editor. */

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
  /** Optional custom rejection text replacing the standard message. */
  message?: string;
}

/** One workbook-level name usable as a range reference inside formulas. */
export interface NamedRange {
  /** Display name; must start with a letter and is unique within the workbook. */
  name: string;
  /** Canonical `[Sheet!]A1[:B2]` reference the name resolves to. */
  range: string;
}

/** One conditional-formatting rule of a worksheet. */
export interface ConditionalFormatRule {
  /** Canonical A1 area the rule's fill applies to. */
  range: string;
  /** Condition name exactly as the dialog offers it. */
  condition: string;
  /** Required comparison text (`Greater than`) or substring (`Text contains`). */
  value: string;
  /** Visible fill name exactly as the dialog offers it. */
  style: string;
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

/** A named, persisted snapshot of a worksheet's filter, shown under "Filter views". */
export interface FilterView {
  /** Stable identity used when applying or deleting the view. */
  id: string;
  /** Trimmed, workbook-unique display name of the view. */
  name: string;
  /** Filter criteria captured when the view was saved. */
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
  /**
   * Note text keyed by cell coordinate (for example `D8`); absent means no
   * cell of this worksheet has a note. A note annotates its cell and never
   * takes part in the cell value or in any formula calculation.
   */
  notes?: Record<string, string>;
  /** Data-validation rules for this worksheet; absent means none. */
  validationRules?: ValidationRule[];
  /** Conditional-formatting rules for this worksheet; absent means none. */
  conditionalFormats?: ConditionalFormatRule[];
  /** Filter view of this worksheet; absent means every row is visible. */
  filter?: WorksheetFilter | null;
  /** Saved filter views of this worksheet; absent means none. */
  filterViews?: FilterView[];
  /** Pivot table stored on this worksheet; absent means it is a plain worksheet. */
  pivot?: WorksheetPivot | null;
  /** Most recent successfully persisted selection; absent means A1. */
  selection?: WorksheetSelection;
  /** Leading rows kept in place while scrolling; absent means none. */
  frozenRows?: number;
  /** Leading columns kept in place while scrolling; absent means none. */
  frozenColumns?: number;
}

export interface Workbook {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeWorksheetId: string;
  worksheets: Worksheet[];
  /** Named ranges usable in formulas across the workbook; absent means none. */
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
export const WORKSHEET_NAME_TOO_LONG_MESSAGE = "Worksheet name must be 50 characters or fewer";
export const LAST_WORKSHEET_MESSAGE = "A workbook must contain at least one worksheet";
export const PIVOT_SOURCE_DEPENDENCY_MESSAGE = "Please delete or rebuild dependent pivot tables first";

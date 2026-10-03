export interface CellCoordinate {
  row: number;
  col: number;
}

export interface CellSelection {
  anchor: CellCoordinate;
  focus: CellCoordinate;
}

export interface Worksheet {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  /** Raw cell content keyed by A1-style coordinate; formulas keep their expression. */
  cells: Record<string, string>;
  selection: CellSelection;
  /** Data-validation rules constraining rectangles of this worksheet. */
  validations?: ValidationRule[];
  /** Row filter of this worksheet, or null when it is not filtered. */
  filter?: WorksheetFilter | null;
}

export interface CellRange {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

/** Inclusive numeric rule; the store and the API enforce it on every write. */
export interface NumericValidationRule {
  id: string;
  type: "numeric";
  min: number;
  max: number;
  range: CellRange;
  /**
   * Wording of the rejection message: `between` is used by rules saved through
   * the "Number range" dialog, `from` (the default) by rules stored without it.
   */
  style?: "from" | "between";
}

/** Exact-list rule for dropdown cells. */
export interface DropdownValidationRule {
  id: string;
  type: "dropdown";
  values: string[];
  range: CellRange;
}

export type ValidationRule = NumericValidationRule | DropdownValidationRule;

/** A rule as sent to the API: the id is optional for a newly created rule. */
export type ValidationRuleInput =
  | (Omit<NumericValidationRule, "id"> & { id?: string })
  | (Omit<DropdownValidationRule, "id"> & { id?: string });

/** Named conditions offered by the filter dialog. */
export type FilterConditionOperator = "contains" | "greaterThan" | "before" | "isEmpty" | "isNotEmpty";

/** Keeps the records whose displayed value is one of the listed source values. */
export interface ValueFilterColumn {
  col: number;
  kind: "values";
  values: string[];
}

/** Keeps the records whose displayed value satisfies the named condition. */
export interface ConditionFilterColumn {
  col: number;
  kind: "condition";
  operator: FilterConditionOperator;
  value: string;
}

export type FilterColumn = ValueFilterColumn | ConditionFilterColumn;

/**
 * Row filter of one worksheet: the covered region (its first row holds the
 * headers) plus one entry per constrained column.
 */
export interface WorksheetFilter {
  range: CellRange;
  columns: FilterColumn[];
}

/** Sort direction of the "Sort range" command. */
export type SortOrder = "ascending" | "descending";

/**
 * One sort of a rectangular range: the rectangle to reorder, the column whose
 * values are the sort keys, the direction, and whether the range's first row
 * is a header that stays out of the sort.
 */
export interface SortRangeSpec {
  range: CellRange;
  col: number;
  order: SortOrder;
  hasHeaderRow: boolean;
}

/** Summarization method of a pivot table value field. */
export type PivotSummarizeMethod = "SUM" | "COUNT" | "AVERAGE";

/**
 * One pivot table of a workbook: the source worksheet and range it reads (its
 * fields are stored by source header text, so a moved/deleted column is
 * detected on refresh), the field selections and the worksheet holding the
 * derived result cells.
 */
export interface PivotTable {
  id: string;
  sourceWorksheetId: string;
  sourceRange: CellRange;
  rowField: string;
  columnField: string | null;
  valueField: string;
  summarizeBy: PivotSummarizeMethod;
  resultWorksheetId: string;
}

export interface Workbook {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeWorksheetId: string;
  worksheets: Worksheet[];
  /** Pivot tables whose result cells live on their own worksheets. */
  pivots?: PivotTable[];
}

/**
 * Whether the server session holds an operation that can be undone/redone.
 * The history itself is server-side and session-only.
 */
export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
}

/** How a range is transferred to its target location. */
export type RangeTransferMode = "copy" | "cut";

export interface WorkbookSummary {
  id: string;
  name: string;
  updatedAt: string;
}

/** Row/column structure commands exposed by the grid header menus. */
export type WorksheetStructureOperation =
  | "insertRowAbove"
  | "insertRowBelow"
  | "deleteRow"
  | "insertColumnLeft"
  | "insertColumnRight"
  | "deleteColumn";

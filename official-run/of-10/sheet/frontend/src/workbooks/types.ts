import type { CellAddress } from "../lib/cells";

export interface CellData {
  /** Text the user submitted: an ordinary value, or the original formula when it starts with "=". */
  value: string;
  /** Text the grid shows: the calculated result of a formula, otherwise the submitted text. */
  display?: string;
}

export interface GridSelectionData {
  anchor: CellAddress;
  focus: CellAddress;
}

export interface ValidationRangeData {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface ValidationRuleData {
  id: string;
  type: "numberRange" | "dropdown";
  range: ValidationRangeData;
  min?: number;
  max?: number;
  allowedValues?: string[];
  message?: string;
}

/** Payload of the validation write endpoint: the target range plus the rule to store. */
export interface ValidationRuleInput {
  range: string;
  type: "numberRange" | "dropdown";
  min?: number;
  max?: number;
  allowedValues?: string[];
}

export type FilterCondition = "textContains" | "greaterThan" | "before" | "isEmpty" | "isNotEmpty";

/** Filter of one column of a filtered region: a set of selected source values or one condition. */
export type ColumnFilterData =
  | { column: number; kind: "values"; selected: string[] }
  | { column: number; kind: "condition"; condition: FilterCondition; value: string };

/** Filter view of a worksheet: the region with its header row and the filter of each used column. */
export interface WorksheetFilterData {
  region: ValidationRangeData;
  columns: ColumnFilterData[];
}

export type PivotSummary = "SUM" | "COUNT" | "AVERAGE";

/** Payload of the sort endpoint: the selected range, the sort column and how the rows are ordered. */
export interface SortRequestInput {
  /** The selected rectangle as an `A1:B2` reference. */
  range: string;
  /** Worksheet column index of the sort column, inside the range. */
  column: number;
  order: SortOrder;
  /** True when the first row is a header row that does not take part in the sort. */
  hasHeader: boolean;
}

export type SortOrder = "ascending" | "descending";

/**
 * Configuration of a pivot result worksheet: the source range it reads plus the selected fields,
 * named by their source header text. The summary itself lives in the worksheet cells.
 */
export interface PivotData {
  sourceWorksheetId: string;
  sourceRange: ValidationRangeData;
  rows: string | null;
  columns: string | null;
  values: string | null;
  summarizeBy: PivotSummary;
}

/** Payload of one `Apply` of the pivot table editor. */
export interface PivotFieldInput {
  rows: string | null;
  columns: string | null;
  values: string | null;
  summarizeBy: PivotSummary;
}

export interface WorksheetData {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  cells: Record<string, CellData>;
  /** Rectangle saved by the most recent successful selection of this worksheet. */
  selection?: GridSelectionData;
  validations?: ValidationRuleData[];
  /** Persisted filter view; hidden rows are only hidden, never deleted or reordered. */
  filter?: WorksheetFilterData | null;
  /** Set on a pivot result worksheet: the source range and field selection it summarizes. */
  pivot?: PivotData | null;
}

export interface WorkbookData {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeWorksheetId: string;
  worksheets: WorksheetData[];
}

export interface WorkbookSummary {
  id: string;
  name: string;
  updatedAt: string;
}

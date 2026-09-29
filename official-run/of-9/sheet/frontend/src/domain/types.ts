export interface CellRecord {
  /** Displayed / calculated value of the cell. */
  value: string;
  /** Raw formula expression when the cell contains a formula. */
  formula?: string;
}

export interface CellRange {
  start: { row: number; column: number };
  end: { row: number; column: number };
}

export type ValidationRuleType = "dropdown" | "number";

export interface ValidationRule {
  id: string;
  range: CellRange;
  type: ValidationRuleType;
  /** Trimmed allowed values of a dropdown rule. */
  allowedValues?: string[];
  /** Inclusive lower bound of a number rule. */
  min?: number;
  /** Inclusive upper bound of a number rule. */
  max?: number;
  [key: string]: unknown;
}

export type FilterConditionName =
  | "text-contains"
  | "greater-than"
  | "before"
  | "is-empty"
  | "is-not-empty";

export type FilterConditionMode = "values" | "condition";

/** One column's filter inside a filter view; `column` is a 1-based absolute column. */
export interface ColumnFilter {
  column: number;
  mode: FilterConditionMode;
  values?: string[];
  condition?: FilterConditionName;
  value?: string;
}

export interface FilterView {
  id: string;
  range: CellRange;
  conditions?: ColumnFilter[];
}

export type SummarizeBy = "SUM" | "COUNT" | "AVERAGE";

export interface PivotConfig {
  sourceSheetId: string;
  sourceRange: CellRange;
  rowField: string;
  rowFieldColumn: number | null;
  columnField: string | null;
  columnFieldColumn: number | null;
  valueField: string;
  valueFieldColumn: number | null;
  summarizeBy: SummarizeBy;
  resultRange?: CellRange | null;
  broken?: boolean;
  lastError?: string | null;
  [key: string]: unknown;
}

export interface Worksheet {
  id: string;
  name: string;
  cells: Record<string, CellRecord>;
  validationRules?: ValidationRule[];
  filterViews?: FilterView[];
  pivot?: PivotConfig | null;
  /** Complete rectangle of the most recent successful selection (persisted per worksheet). */
  selection?: CellRange | null;
}

export interface Workbook {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeSheetId: string;
  sheets: Worksheet[];
}

export interface WorkbookSummary {
  id: string;
  name: string;
  updatedAt: string;
}

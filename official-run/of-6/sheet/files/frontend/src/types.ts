export interface CellMap {
  [coordinate: string]: string;
}

export type FilterCondition =
  | 'text-contains'
  | 'greater-than'
  | 'before'
  | 'is-empty'
  | 'is-not-empty';

export interface FilterCriterion {
  // 0-based column index in the worksheet
  column: number;
  // Value filter: the source values to keep ([] hides every data row of the
  // column). Exactly one of selectedValues / condition is set on a criterion.
  selectedValues?: string[];
  condition?: FilterCondition;
  // Text/number/date operand for text-contains / greater-than / before.
  value?: string;
}

export interface FilterView {
  id: string;
  name: string;
  // Data region with headers, e.g. "A1:C6"; the first row is the header row.
  range?: string;
  criteria?: FilterCriterion[];
}

export interface ValidationRule {
  id: string;
  range: string;
  type: string;
  // Dropdown allowed values, trimmed of leading/trailing spaces.
  values?: string[];
  min?: number;
  max?: number;
}

export type PivotSummarizeBy = 'SUM' | 'COUNT' | 'AVERAGE';

export interface PivotConfig {
  // Header texts of the source range fields. columnField is optional (one
  // optional column field); rowField and valueField are required.
  rowField: string;
  columnField?: string;
  valueField: string;
  summarizeBy: PivotSummarizeBy;
}

export interface PivotResult {
  id: string;
  name: string;
  // The source worksheet the pivot summarizes (the worksheet tab that shows
  // the pivot in the "Pivot table results" section).
  sheetId?: string;
  // The separate pivot-result worksheet that holds the summary cells.
  resultSheetId?: string;
  sourceRange?: string;
  // Field layout chosen in the "Pivot table editor". Absent for legacy
  // (REQ-2-2-x) pivots that only carry a source range.
  config?: PivotConfig;
  stale?: boolean;
  adjustedRange?: string;
  fieldError?: boolean;
}

export interface SheetSelection {
  anchor: string;
  active: string;
}

export interface Sheet {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  cells: CellMap;
  filterViews: FilterView[];
  validationRules: ValidationRule[];
  selection?: SheetSelection | null;
}

export interface Workbook {
  id: string;
  name: string;
  lastUpdated: string;
  activeSheetId: string;
  sheets: Sheet[];
  pivots: PivotResult[];
}

export interface WorkbookSummary {
  id: string;
  name: string;
  lastUpdated: string;
}

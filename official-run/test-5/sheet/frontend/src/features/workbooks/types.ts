export interface ValidationRule {
  id: string;
  range: { start: string; end: string };
  type: string;
  min?: number;
  max?: number;
  /** Allowed values of a `dropdown` rule, already trimmed. */
  values?: string[];
  message?: string;
}

/** One filtered column of a worksheet filter, keyed by column letter. */
export type FilterColumn =
  | { kind: "values"; values: string[] }
  | { kind: "condition"; operator: string; value: string };

export interface WorksheetFilter {
  range: { start: string; end: string };
  columns: Record<string, FilterColumn>;
}

export interface WorksheetData {
  id: string;
  name: string;
  /** Raw cell texts, authoritative for the formula bar and the stored state. */
  cells: Record<string, string>;
  /** Derived display values (formula results) computed by the server. */
  values?: Record<string, string>;
  activeCell: string;
  /** Opposite corner of the persisted selection rectangle. */
  selectionFocus?: string;
  validations?: ValidationRule[];
  /** Data region the worksheet's filter was created for, or null. */
  filter?: WorksheetFilter | null;
  /** Data rows of the filter range that do not match; derived by the server. */
  hiddenRows?: number[];
}

export interface WorkbookData {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeWorksheetId: string;
  worksheets: WorksheetData[];
  /** Undo/redo availability of the current session (process memory only). */
  canUndo?: boolean;
  canRedo?: boolean;
}

export interface WorkbookSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

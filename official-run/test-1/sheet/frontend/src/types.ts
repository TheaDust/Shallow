export interface Sheet {
  id: string;
  name: string;
  /** Last confirmed selected cell coordinate, e.g. "A1". */
  activeCell: string;
  /** Last confirmed selected rectangle (REQ-3-1-3); defaults to the active cell. */
  selection?: WorkbookSelection;
  /** Cell values keyed by coordinate (e.g. "A1"); formula text is stored as-is. */
  cells: Record<string, string>;
  /** Declared used-range size for imported sheets (preserves empty fields). */
  rowCount?: number;
  columnCount?: number;
}

export interface Workbook {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeSheetId: string;
  sheets: Sheet[];
}

export interface WorkbookSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export interface WorkbookSelection {
  /** Current (anchor) cell coordinate. */
  current: string;
  /** Opposite corner of the selected rectangular region. */
  end: string;
}

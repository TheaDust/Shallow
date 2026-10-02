import type { ValidationRule, Workbook, Worksheet, WorksheetFilter } from "./workbook";

/**
 * Undo/redo history for the current workbook session (REQ-3-2-2).
 *
 * Every successful mutation records the worksheet content *before* and *after*
 * the operation; undo writes the `before` state back, redo the `after` state.
 * A snapshot covers exactly what the requirements list — grid values, original
 * formulas, the used rectangle and the explicit grid size (row/column
 * structure) and the validation rules — so restoring one cannot drift from the
 * derived formula results, which are always computed from the restored cells.
 * The history itself lives in the browser session, so it is empty after a
 * reload while the state it produced stays persisted.
 */
export interface WorksheetSnapshot {
  rowCount: number;
  columnCount: number;
  usedRows: number;
  usedCols: number;
  /** Stored input text per coordinate: ordinary values and `=` formula text. */
  cells: Record<string, string>;
  /** Rule ranges; absent when the worksheet carries no rules. */
  validations?: ValidationRule[];
  /**
   * Filter view of the worksheet; absent when it has none. The key is omitted
   * (not `null`) in that case, so restoring an older snapshot never clears a
   * filter that was created afterwards.
   */
  filter?: WorksheetFilter;
}

export interface HistoryEntry {
  workbookId: string;
  worksheetId: string;
  /** Short description of the operation, used only for diagnostics. */
  label: string;
  before: WorksheetSnapshot;
  after: WorksheetSnapshot;
}

export function snapshotWorksheet(worksheet: Worksheet): WorksheetSnapshot {
  const snapshot: WorksheetSnapshot = {
    rowCount: worksheet.rowCount,
    columnCount: worksheet.columnCount,
    usedRows: worksheet.usedRows ?? 0,
    usedCols: worksheet.usedCols ?? 0,
    cells: { ...worksheet.cells },
  };
  if (Array.isArray(worksheet.validations)) {
    snapshot.validations = worksheet.validations.map((rule) => ({ ...rule }));
  }
  if (worksheet.filter) {
    snapshot.filter = { range: worksheet.filter.range, rules: worksheet.filter.rules.map((rule) => ({ ...rule })) };
  }
  return snapshot;
}

/** Canonical form of a snapshot: cell order in the map must not decide equality. */
export function snapshotKey(snapshot: WorksheetSnapshot): string {
  const cells = Object.entries(snapshot.cells).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return JSON.stringify({ ...snapshot, cells });
}

/** True when two snapshots describe the same worksheet state. */
export function sameSnapshot(left: WorksheetSnapshot, right: WorksheetSnapshot): boolean {
  return snapshotKey(left) === snapshotKey(right);
}

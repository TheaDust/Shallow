import { adjustFormulaOffset } from "./formulas.mjs";
import { cellCoordinate, isCellCoordinate, parseCellCoordinate } from "./spreadsheet.mjs";

/**
 * Copy/cut of one rectangular range onto a target location of the *same* worksheet. Everything is
 * planned from the worksheet's current state before a single cell is written, so the caller can
 * reject the whole operation (validation rules) without leaving a partial write behind.
 */

export const RANGE_TRANSFER_MODES = ["copy", "cut"];

/** Normalizes `{ start, end }` into row/column bounds; `null` when a coordinate is unusable. */
export function normalizeRectangle(rectangle) {
  if (!isCellCoordinate(rectangle?.start) || !isCellCoordinate(rectangle?.end)) return null;
  const start = parseCellCoordinate(rectangle.start);
  const end = parseCellCoordinate(rectangle.end);
  return {
    start,
    end,
    minRow: Math.min(start.row, end.row),
    maxRow: Math.max(start.row, end.row),
    minColumn: Math.min(start.column, end.column),
    maxColumn: Math.max(start.column, end.column),
  };
}

/**
 * Plan of a range transfer: the writes of the target rectangle (values and formulas preserve their
 * two-dimensional layout, copied formulas follow the target offset), the cells a cut clears, and
 * the grid size the target needs. Returns `null` for an unusable rectangle or mode.
 */
export function planRangeTransfer(worksheet, { source, target, mode } = {}) {
  const from = normalizeRectangle(source);
  const to = normalizeRectangle(target);
  if (!from || !to || !RANGE_TRANSFER_MODES.includes(mode)) return null;

  const rowDelta = to.start.row - from.start.row;
  const columnDelta = to.start.column - from.start.column;
  const writes = [];
  const clears = [];
  for (let row = from.minRow; row <= from.maxRow; row += 1) {
    for (let column = from.minColumn; column <= from.maxColumn; column += 1) {
      const coordinate = cellCoordinate(row, column);
      writes.push({
        coordinate: cellCoordinate(row + rowDelta, column + columnDelta),
        value: adjustFormulaOffset(worksheet.cells[coordinate] ?? "", { rowDelta, columnDelta }),
      });
      if (mode === "cut") clears.push(coordinate);
    }
  }
  return {
    mode,
    writes,
    clears,
    targetRows: from.maxRow + rowDelta + 1,
    targetColumns: from.maxColumn + columnDelta + 1,
  };
}

/**
 * Applies a plan to one normalized worksheet. A cut clears the source rectangle before the target
 * is written, so an overlapping transfer keeps the moved value on the target: the target is fully
 * displayed and the source is cleared in the same state update.
 */
export function applyRangeTransfer(worksheet, plan) {
  for (const coordinate of plan.clears) delete worksheet.cells[coordinate];
  for (const write of plan.writes) {
    if (write.value === "") delete worksheet.cells[write.coordinate];
    else worksheet.cells[write.coordinate] = write.value;
  }
  worksheet.rowCount = Math.max(worksheet.rowCount, plan.targetRows);
  worksheet.columnCount = Math.max(worksheet.columnCount, plan.targetColumns);
  return worksheet;
}

import { cellCoordinate } from "./workbook-model.mjs";
import { MAX_COLUMN_COUNT, MAX_ROW_COUNT } from "./structure.mjs";
import { shiftFormulaByOffset } from "./formula.mjs";
import { validateCellWrites } from "./validation.mjs";

/**
 * Range transfer inside one worksheet (`copy` or `cut` + paste at a target
 * location).
 *
 * The whole transfer is planned before anything is written: the source values
 * keep their two-dimensional layout, copied formulas move their relative
 * references by the offset between the two top-left corners (absolute `$`
 * references stay put) and the target rectangle is checked against the
 * worksheet's validation rules. The returned worksheet is a new object; the
 * caller persists it only when the plan succeeded, so a rejected transfer can
 * never leave a partial state behind.
 */

const TOO_LARGE_MESSAGE = "The pasted data does not fit in the worksheet";
const INVALID_RANGE_MESSAGE = "Invalid range";

export function isTransferMode(mode) {
  return mode === "copy" || mode === "cut";
}

function boundsOf(selection) {
  return {
    minRow: Math.min(selection.anchor.row, selection.focus.row),
    maxRow: Math.max(selection.anchor.row, selection.focus.row),
    minCol: Math.min(selection.anchor.col, selection.focus.col),
    maxCol: Math.max(selection.anchor.col, selection.focus.col),
  };
}

function insideGrid(bounds, worksheet) {
  return (
    bounds.minRow >= 0 &&
    bounds.minCol >= 0 &&
    bounds.maxRow < worksheet.rowCount &&
    bounds.maxCol < worksheet.columnCount
  );
}

function rawRange(worksheet, bounds) {
  const rows = [];
  for (let row = bounds.minRow; row <= bounds.maxRow; row += 1) {
    const line = [];
    for (let col = bounds.minCol; col <= bounds.maxCol; col += 1) {
      const value = worksheet.cells[cellCoordinate(row, col)];
      line.push(typeof value === "string" ? value : "");
    }
    rows.push(line);
  }
  return rows;
}

/**
 * Plans one transfer. Returns `{ok: true, worksheet}` with the complete new
 * worksheet state or `{ok: false, error}` with the message the page displays.
 */
export function transferRange(worksheet, source, target, mode) {
  if (!isTransferMode(mode)) return { ok: false, error: "Unknown transfer mode" };
  if (!source || !target) return { ok: false, error: INVALID_RANGE_MESSAGE };

  const sourceBounds = boundsOf(source);
  const targetBounds = boundsOf(target);
  if (!insideGrid(sourceBounds, worksheet) || !insideGrid(targetBounds, worksheet)) {
    return { ok: false, error: INVALID_RANGE_MESSAGE };
  }

  const height = sourceBounds.maxRow - sourceBounds.minRow + 1;
  const width = sourceBounds.maxCol - sourceBounds.minCol + 1;
  const rowCount = Math.max(worksheet.rowCount, targetBounds.minRow + height);
  const columnCount = Math.max(worksheet.columnCount, targetBounds.minCol + width);
  if (rowCount > MAX_ROW_COUNT || columnCount > MAX_COLUMN_COUNT) {
    return { ok: false, error: TOO_LARGE_MESSAGE };
  }

  // A cut moves the cells as they are; a copy moves relative references by the
  // offset between the source and the target top-left corners.
  const rowDelta = targetBounds.minRow - sourceBounds.minRow;
  const colDelta = targetBounds.minCol - sourceBounds.minCol;
  const plan = { rowCount, columnCount };
  const values = rawRange(worksheet, sourceBounds).map((line) =>
    mode === "copy"
      ? line.map((value) => shiftFormulaByOffset(value, rowDelta, colDelta, plan))
      : line,
  );

  const start = { row: targetBounds.minRow, col: targetBounds.minCol };
  const check = validateCellWrites(worksheet, start, values);
  if (!check.ok) return { ok: false, error: check.error };

  const cells = { ...worksheet.cells };
  const targetInside = (row, col) =>
    row >= targetBounds.minRow &&
    row < targetBounds.minRow + height &&
    col >= targetBounds.minCol &&
    col < targetBounds.minCol + width;

  values.forEach((line, rowOffset) => {
    line.forEach((value, colOffset) => {
      const key = cellCoordinate(start.row + rowOffset, start.col + colOffset);
      if (value === "") delete cells[key];
      else cells[key] = value;
    });
  });

  if (mode === "cut") {
    for (let row = sourceBounds.minRow; row <= sourceBounds.maxRow; row += 1) {
      for (let col = sourceBounds.minCol; col <= sourceBounds.maxCol; col += 1) {
        if (targetInside(row, col)) continue;
        delete cells[cellCoordinate(row, col)];
      }
    }
  }

  return {
    ok: true,
    worksheet: { ...worksheet, rowCount, columnCount, cells },
  };
}

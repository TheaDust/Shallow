/**
 * Moving a rectangular selection inside one worksheet: copy or cut a source rectangle and
 * paste it at a target location.
 *
 * The whole transfer is applied in one pass over a snapshot of the source rectangle, so the
 * worksheet either receives every destination value (and, for a cut, loses every source
 * value) or stays exactly as it was. Copying translates the relative references of copied
 * formulas by the target offset while absolute (`$`) references stay put; cutting moves the
 * submitted text unchanged. Cells outside the two rectangles are never touched.
 */

import { cellAddress, parseAddress } from "./address.mjs";
import { translateFormulaText } from "./reference.mjs";
import { sheetColumnCount, sheetRowCount } from "./structure.mjs";
import { validationMessageFor } from "./validation.mjs";

export const RANGE_MODE_INVALID_MESSAGE = "Unknown range operation";
export const RANGE_ADDRESS_INVALID_MESSAGE = "Invalid cell address";
export const RANGE_TARGET_OUT_OF_GRID_MESSAGE = "The pasted range does not fit in the worksheet";

const RANGE_MODES = ["copy", "cut"];

/** Zero-based rectangle of a `{ start, end }` selection (or of one address). */
function rectangleOf(value) {
  if (!value || typeof value !== "object") return null;
  let startText = typeof value.start === "string" ? value.start : "";
  let endText = typeof value.end === "string" ? value.end : "";
  // A single `"A1:B2"` range string is accepted as well as a `{ start, end }` pair.
  if (!endText && startText.includes(":")) {
    const [from, to] = startText.split(":");
    startText = from;
    endText = to ?? from;
  }
  const start = parseAddress(startText);
  const end = parseAddress(endText) ?? start;
  if (!start || !end) return null;
  return {
    top: Math.min(start.row, end.row),
    bottom: Math.max(start.row, end.row),
    left: Math.min(start.column, end.column),
    right: Math.max(start.column, end.column),
  };
}

/**
 * Applies one copy/cut + paste of a rectangle.
 *
 * @param {object} sheet worksheet whose `cells` are rewritten
 * @param {{ source?: unknown, target?: unknown, mode?: unknown }} payload
 * @returns {{ ok: true, selection: { start: string, end: string } } | { ok: false, error: string }}
 */
export function applyRangeTransfer(sheet, { source, target, mode } = {}) {
  if (!RANGE_MODES.includes(mode)) return { ok: false, error: RANGE_MODE_INVALID_MESSAGE };
  const sourceRect = rectangleOf(source);
  const targetRect = rectangleOf(target);
  if (!sourceRect || !targetRect) return { ok: false, error: RANGE_ADDRESS_INVALID_MESSAGE };

  const rows = sheetRowCount(sheet);
  const columns = sheetColumnCount(sheet);
  if (sourceRect.bottom > rows || sourceRect.right > columns) {
    return { ok: false, error: RANGE_ADDRESS_INVALID_MESSAGE };
  }

  const height = sourceRect.bottom - sourceRect.top + 1;
  const width = sourceRect.right - sourceRect.left + 1;
  const originRow = targetRect.top;
  const originColumn = targetRect.left;
  if (originRow + height > rows || originColumn + width > columns) {
    return { ok: false, error: RANGE_TARGET_OUT_OF_GRID_MESSAGE };
  }

  const rowDelta = originRow - sourceRect.top;
  const columnDelta = originColumn - sourceRect.left;

  // Read the whole source rectangle before writing anything, so overlapping cut/paste
  // keeps the original values and every target cell is validated first.
  const entries = [];
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const from = cellAddress(sourceRect.top + row, sourceRect.left + column);
      const to = cellAddress(originRow + row, originColumn + column);
      const raw = sheet.cells?.[from] ?? "";
      const value =
        mode === "copy" && String(raw).startsWith("=")
          ? translateFormulaText(String(raw), rowDelta, columnDelta, { rows, columns })
          : raw;
      const rejected = validationMessageFor(sheet, to, value);
      if (rejected) return { ok: false, error: rejected };
      entries.push({ from, to, value });
    }
  }

  if (mode === "cut") {
    for (const entry of entries) delete sheet.cells[entry.from];
  }
  for (const entry of entries) {
    if (entry.value === "") delete sheet.cells[entry.to];
    else sheet.cells[entry.to] = entry.value;
  }

  const selection = {
    start: cellAddress(originRow, originColumn),
    end: cellAddress(originRow + height - 1, originColumn + width - 1),
  };
  sheet.selection = selection;
  return { ok: true, selection };
}

/**
 * Range transfer (copy / cut) inside one worksheet.
 *
 * A transfer reads the raw texts of a source rectangle, places them on a target
 * rectangle of the same size starting at the target's top-left corner and, for a
 * cut, clears the source cells that the pasted rectangle does not cover. The
 * result is one `{ address: rawText }` map, so the caller can apply the whole
 * transfer with the regular all-or-nothing cell write: either the source, the
 * target and every dependent formula update together, or nothing changes.
 *
 * Copied formulas keep their two-dimensional layout: ordinary (relative)
 * references move by the target offset, `$`-anchored parts stay put, and a
 * reference pushed outside the grid becomes `#REF!`. Coefficients beyond the
 * grid are rejected instead of being dropped silently.
 */

import { cellAddress, columnLabel, parseCellAddress } from "./coordinates.mjs";
import { GRID_COLUMN_COUNT, GRID_ROW_COUNT, qualifierMatchesSheet, rewriteFormulaReferences } from "./structure.mjs";

export const COPY_MODE = "copy";
export const CUT_MODE = "cut";
export const TRANSFER_MODES = Object.freeze([COPY_MODE, CUT_MODE]);

export const INVALID_RANGE_MESSAGE = "Invalid range";
export const UNKNOWN_TRANSFER_MODE_MESSAGE = "Unknown transfer mode";
export const OUT_OF_GRID_MESSAGE = "Cell is outside the worksheet bounds";

/** One A1 endpoint of a reference, with its `$` anchors. */
const ENDPOINT_PATTERN = /^(\$?)([A-Za-z]{1,3})(\$?)([0-9]{1,7})$/;

function parseRangeValue(value) {
  if (typeof value === "string") {
    const [start, end = start] = value.split(":");
    return { start, end };
  }
  if (value && typeof value === "object") {
    const start = value.start;
    return { start, end: value.end ?? start };
  }
  return null;
}

/**
 * Normalizes a submitted range (`"D1:E2"`, `"D1"` or `{start,end}`) into its
 * top-left/bottom-right corners. Returns null when either corner is not a
 * coordinate inside the grid.
 */
export function normalizeTransferRange(value) {
  const raw = parseRangeValue(value);
  if (!raw || typeof raw.start !== "string") return null;
  const first = parseCellAddress(raw.start);
  const second = typeof raw.end === "string" ? parseCellAddress(raw.end) : first;
  if (!first || !second) return null;
  const corners = {
    left: Math.min(first.column, second.column),
    right: Math.max(first.column, second.column),
    top: Math.min(first.row, second.row),
    bottom: Math.max(first.row, second.row),
  };
  if (corners.left < 1 || corners.right > GRID_COLUMN_COUNT) return null;
  if (corners.top < 1 || corners.bottom > GRID_ROW_COUNT) return null;
  return {
    start: cellAddress(corners.left, corners.top),
    end: cellAddress(corners.right, corners.bottom),
    left: corners.left,
    right: corners.right,
    top: corners.top,
    bottom: corners.bottom,
  };
}

/** Horizontal and vertical size of a normalized range. */
function rangeSize(range) {
  return { rows: range.bottom - range.top + 1, columns: range.right - range.left + 1 };
}

/** One endpoint moved by the transfer offset, or null when it leaves the grid. */
function offsetEndpoint(text, rowDelta, columnDelta) {
  const match = ENDPOINT_PATTERN.exec(text);
  if (!match) return null;
  const [, columnDollar, letters, rowDollar, digits] = match;
  const column = parseCellAddress(`${letters}1`)?.column ?? null;
  const row = Number(digits);
  if (!column || !Number.isInteger(row)) return null;
  const nextColumn = columnDollar === "$" ? column : column + columnDelta;
  const nextRow = rowDollar === "$" ? row : row + rowDelta;
  if (nextColumn < 1 || nextColumn > GRID_COLUMN_COUNT) return null;
  if (nextRow < 1 || nextRow > GRID_ROW_COUNT) return null;
  return `${columnDollar}${columnLabel(nextColumn)}${rowDollar}${nextRow}`;
}

/**
 * Formula text with its relative references moved by the target offset; the
 * `$`-anchored parts of a reference and foreign-sheet references are kept.
 */
export function offsetFormulaText(text, rowDelta, columnDelta, worksheetName) {
  return rewriteFormulaReferences(text, ({ sheetPrefix, first, second, match }) => {
    if (!qualifierMatchesSheet(sheetPrefix, worksheetName)) return match;
    const prefix = sheetPrefix ? `${sheetPrefix}!` : "";
    const start = offsetEndpoint(first, rowDelta, columnDelta);
    if (start === null) return null;
    if (second === undefined) return `${prefix}${start}`;
    const end = offsetEndpoint(second, rowDelta, columnDelta);
    return end === null ? null : `${prefix}${start}:${end}`;
  });
}

/**
 * Cell texts a transfer would write. Returns `{ ok: true, updates }` or
 * `{ ok: false, error }` without touching the worksheet: the caller applies the
 * map through the atomic cell write, which also enforces the validation rules.
 */
export function transferUpdates(worksheet, request) {
  const mode = request?.mode;
  if (!TRANSFER_MODES.includes(mode)) return { ok: false, error: UNKNOWN_TRANSFER_MODE_MESSAGE };
  const source = normalizeTransferRange(request?.source);
  const target = normalizeTransferRange(request?.target);
  if (!source || !target) return { ok: false, error: INVALID_RANGE_MESSAGE };
  const size = rangeSize(source);
  const targetRight = target.left + size.columns - 1;
  const targetBottom = target.top + size.rows - 1;
  if (targetRight > GRID_COLUMN_COUNT || targetBottom > GRID_ROW_COUNT) {
    return { ok: false, error: OUT_OF_GRID_MESSAGE };
  }
  const rowDelta = target.top - source.top;
  const columnDelta = target.left - source.left;
  const cells = worksheet.cells ?? {};
  const updates = {};
  for (let row = source.top; row <= source.bottom; row += 1) {
    for (let column = source.left; column <= source.right; column += 1) {
      const raw = cells[cellAddress(column, row)] ?? "";
      const text = typeof raw === "string" && raw.startsWith("=")
        ? offsetFormulaText(raw, rowDelta, columnDelta, worksheet.name)
        : raw;
      updates[cellAddress(target.left + (column - source.left), target.top + (row - source.top))] = text;
    }
  }
  if (mode === CUT_MODE) {
    for (let row = source.top; row <= source.bottom; row += 1) {
      for (let column = source.left; column <= source.right; column += 1) {
        const address = cellAddress(column, row);
        // A cell of the source rectangle that received pasted data keeps it.
        if (!(address in updates)) updates[address] = "";
      }
    }
  }
  return { ok: true, updates };
}

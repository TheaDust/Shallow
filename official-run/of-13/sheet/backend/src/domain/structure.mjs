import { cellAddress, parseAddress } from "./address.mjs";
import { adjustFormulaTextForStructure } from "./reference.mjs";

/**
 * Row/column structure operations for a single worksheet. Every operation rewrites the
 * worksheet's sparse A1 cell map in one pass, so a successful call either moves the whole
 * affected band or changes nothing; callers never observe a partially shifted sheet.
 *
 * The band and everything that points into it move together: the raw text of the shifted
 * cells keeps its value, the references of every formula of the worksheet are rewritten so
 * they still address the same data (`#REF!` when they addressed a deleted row/column), and the
 * ranges of the worksheet's validation rules and of its filter view are shifted with the band.
 *
 * Inserting rows or columns grows the worksheet grid (`rowCount` / `columnCount`) so the
 * pushed-out band is kept instead of falling off the grid; deleting keeps the grid size and
 * leaves the freed row/column at the far edge blank, exactly like a spreadsheet.
 *
 * A pivot table that reads this worksheet lives on its own worksheet, so `api.mjs` shifts its
 * stored source range with `shiftRangeForStructure` after the operation succeeded; the already
 * computed pivot summary is left untouched and only changes on the next explicit refresh.
 */

export const DEFAULT_ROW_COUNT = 50;
export const DEFAULT_COLUMN_COUNT = 26;

export const ROW_ACTION_INVALID_MESSAGE = "Unknown row operation";
export const COLUMN_ACTION_INVALID_MESSAGE = "Unknown column operation";
export const ROW_NUMBER_INVALID_MESSAGE = "Invalid row number";
export const COLUMN_NUMBER_INVALID_MESSAGE = "Invalid column number";

export const ROW_ACTIONS = ["insert-above", "insert-below", "delete"];
export const COLUMN_ACTIONS = ["insert-left", "insert-right", "delete"];

export function sheetRowCount(sheet) {
  const count = Number(sheet?.rowCount);
  return Number.isInteger(count) && count > 0 ? count : DEFAULT_ROW_COUNT;
}

export function sheetColumnCount(sheet) {
  const count = Number(sheet?.columnCount);
  return Number.isInteger(count) && count > 0 ? count : DEFAULT_COLUMN_COUNT;
}

/**
 * The raw text one cell carries after the change: formulas keep addressing the same data,
 * every other value moves unchanged.
 */
function movedValue(value, change) {
  return typeof value === "string" && value.startsWith("=")
    ? adjustFormulaTextForStructure(value, change)
    : value;
}

/** Moves every cell at or after `at` on the axis by `count` cells (insertion). */
function shiftBand(cells, axis, at, count, change) {
  const shifted = {};
  for (const [address, value] of Object.entries(cells ?? {})) {
    const position = parseAddress(address);
    if (!position) {
      shifted[address] = value;
      continue;
    }
    const delta = position[axis] >= at ? count : 0;
    const next =
      axis === "row"
        ? cellAddress(position.row + delta, position.column)
        : cellAddress(position.row, position.column + delta);
    shifted[next] = movedValue(value, change);
  }
  return shifted;
}

/** Drops the `count` cells starting at `at` and pulls the following band back (deletion). */
function removeBand(cells, axis, at, count, change) {
  const kept = {};
  for (const [address, value] of Object.entries(cells ?? {})) {
    const position = parseAddress(address);
    if (!position) {
      kept[address] = value;
      continue;
    }
    const current = position[axis];
    if (current >= at && current < at + count) continue;
    const delta = current >= at + count ? -count : 0;
    const next =
      axis === "row"
        ? cellAddress(position.row + delta, position.column)
        : cellAddress(position.row, position.column + delta);
    kept[next] = movedValue(value, change);
  }
  return kept;
}

const RANGE_PATTERN = /^([A-Za-z]+)([1-9]\d*)(?::([A-Za-z]+)([1-9]\d*))?$/;

function columnIndexOf(letters) {
  let column = 0;
  for (const letter of letters.toUpperCase()) column = column * 26 + (letter.charCodeAt(0) - 64);
  return column;
}

/** A1 letters of a 1-based column number. */
function columnLetters(index) {
  let label = "";
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) {
    label = String.fromCharCode(65 + ((value - 1) % 26)) + label;
  }
  return label;
}

/**
 * Moves one 1-based coordinate span of the changed axis the way a reference moves: an
 * insertion pushes everything at or after it, a deletion pulls the following coordinates back
 * and removes the deleted one. `null` when nothing is left of the span.
 */
function shiftSpan([low, high], change) {
  if (!change) return [low, high];
  if (change.action === "delete") {
    const nextLow = low > change.index ? low - 1 : low;
    const nextHigh = high >= change.index ? high - 1 : high;
    return nextHigh < nextLow ? null : [nextLow, nextHigh];
  }
  const insertAbove = change.axis === "row" ? "insert-above" : "insert-left";
  const insertion = change.action === insertAbove ? change.index : change.index + 1;
  return [low >= insertion ? low + 1 : low, high >= insertion ? high + 1 : high];
}

/**
 * One stored A1 range (`A1:C4`) after the change, or `null` when the change removed every
 * row/column it covered. Used for the ranges of validation rules and filter views, and — from
 * `domain/pivot.mjs` — for the source range of a pivot table of another worksheet.
 */
export function shiftRangeForStructure(range, change) {
  const match = RANGE_PATTERN.exec(String(range ?? "").trim());
  if (!match) return range;
  const rowNumbers = [Number(match[2]), Number(match[4] ?? match[2])];
  const columnNumbers =
    match[3] === undefined
      ? [columnIndexOf(match[1])]
      : [columnIndexOf(match[1]), columnIndexOf(match[3])];
  const rows = shiftSpan(
    [Math.min(...rowNumbers), Math.max(...rowNumbers)],
    change?.axis === "row" ? change : null,
  );
  const columns = shiftSpan(
    [Math.min(...columnNumbers), Math.max(...columnNumbers)],
    change?.axis === "column" ? change : null,
  );
  if (!rows || !columns) return null;
  const start = cellAddress(rows[0] - 1, columns[0] - 1);
  const end = cellAddress(rows[1] - 1, columns[1] - 1);
  return match[3] === undefined && start === end ? start : `${start}:${end}`;
}

/**
 * The worksheet's filter view after the change: its range moves with the band (and disappears
 * with a fully deleted region) while every constrained column keeps addressing the same column;
 * a constraint on a deleted column is dropped.
 */
function shiftFilter(filter, change) {
  if (!filter) return null;
  const range = shiftRangeForStructure(filter.range, change);
  if (range === null) return null;
  const columns = [];
  for (const entry of filter.columns ?? []) {
    const index = columnIndexOf(entry.column);
    const span = shiftSpan([index, index], change.axis === "column" ? change : null);
    if (!span) continue;
    columns.push({ ...entry, column: columnLetters(span[0]) });
  }
  return { ...filter, range, columns };
}

function applyOperation(sheet, { axis, action, index, limit, allowed, actionMessage, numberMessage }) {
  if (!allowed.includes(action)) return { ok: false, error: actionMessage };
  if (typeof index !== "number" || !Number.isInteger(index) || index < 1 || index > limit) {
    return { ok: false, error: numberMessage };
  }
  const change = { axis, action, index };
  const zeroBased = index - 1;
  if (action === "delete") {
    sheet.cells = removeBand(sheet.cells, axis, zeroBased, 1, change);
  } else {
    const insertAt =
      action === "insert-below" || action === "insert-right" ? zeroBased + 1 : zeroBased;
    sheet.cells = shiftBand(sheet.cells, axis, insertAt, 1, change);
    if (axis === "row") sheet.rowCount = sheetRowCount(sheet) + 1;
    else sheet.columnCount = sheetColumnCount(sheet) + 1;
  }
  if (Array.isArray(sheet.validations)) {
    sheet.validations = sheet.validations
      .map((rule) => {
        const range = shiftRangeForStructure(rule?.range, change);
        return range === null ? null : { ...rule, range };
      })
      .filter((rule) => rule !== null);
  }
  if (sheet.filter) {
    const filter = shiftFilter(sheet.filter, change);
    if (filter) sheet.filter = filter;
    else delete sheet.filter;
  }
  return { ok: true };
}

/** @param {{ action?: unknown, row?: unknown }} payload 1-based `row`; mutates `sheet` on success. */
export function applyRowOperation(sheet, payload) {
  return applyOperation(sheet, {
    axis: "row",
    action: payload?.action,
    index: payload?.row,
    limit: sheetRowCount(sheet),
    allowed: ROW_ACTIONS,
    actionMessage: ROW_ACTION_INVALID_MESSAGE,
    numberMessage: ROW_NUMBER_INVALID_MESSAGE,
  });
}

/** @param {{ action?: unknown, column?: unknown }} payload 1-based `column`; mutates `sheet` on success. */
export function applyColumnOperation(sheet, payload) {
  return applyOperation(sheet, {
    axis: "column",
    action: payload?.action,
    index: payload?.column,
    limit: sheetColumnCount(sheet),
    allowed: COLUMN_ACTIONS,
    actionMessage: COLUMN_ACTION_INVALID_MESSAGE,
    numberMessage: COLUMN_NUMBER_INVALID_MESSAGE,
  });
}

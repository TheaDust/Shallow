/**
 * Row and column structure changes for a single worksheet.
 *
 * Coordinates are 1-based. Inserting a line at index `at` shifts that line and
 * every following line down (row) or right (column) by one; deleting a line
 * removes it and shifts the following lines up/left. Formula text is rewritten
 * so references keep pointing at the same data: a reference whose target moved
 * follows it, while a reference to a deleted cell becomes `#REF!`.
 *
 * Every function is pure and returns a new cell map; the caller stores it in one
 * atomic write, so a rejected change never leaves a half-moved grid behind.
 */

import { cellName, parseArea, parseCellName } from "./grid.mjs";

const CELL_REFERENCE = "[A-Za-z]{1,3}[1-9][0-9]*";
const RANGE_OR_CELL_PATTERN = new RegExp(
  `(${CELL_REFERENCE}):(${CELL_REFERENCE})|${CELL_REFERENCE}`,
  "g",
);

export const ROW_AXIS = "row";
export const COLUMN_AXIS = "column";
export const STRUCTURE_AXES = [ROW_AXIS, COLUMN_AXIS];
export const STRUCTURE_MODES = ["insert-before", "insert-after", "delete"];

/**
 * Moves one rectangular block of coordinates. Returns the mapped rectangle, or
 * `null` when the block no longer exists because the deleted line covered it.
 */
function mapRectangle(axis, mode, at, start, end) {
  const top = Math.min(start.row, end.row);
  const bottom = Math.max(start.row, end.row);
  const left = Math.min(start.column, end.column);
  const right = Math.max(start.column, end.column);

  if (axis === ROW_AXIS) {
    if (mode === "delete") {
      return { top: top > at ? top - 1 : top, bottom: bottom >= at ? bottom - 1 : bottom, left, right };
    }
    return { top: top >= at ? top + 1 : top, bottom: bottom >= at ? bottom + 1 : bottom, left, right };
  }
  if (mode === "delete") {
    return { top, bottom, left: left > at ? left - 1 : left, right: right >= at ? right - 1 : right };
  }
  return { top, bottom, left: left >= at ? left + 1 : left, right: right >= at ? right + 1 : right };
}

function isCollapsed(rectangle) {
  return rectangle.bottom < rectangle.top || rectangle.right < rectangle.left;
}

/** New coordinate of a single cell, or `null` when the cell was deleted. */
function mapPosition(axis, mode, at, position) {
  const mapped = mapRectangle(axis, mode, at, position, position);
  if (isCollapsed(mapped)) return null;
  return { row: mapped.top, column: mapped.left };
}

/** Rewrites every reference in a formula body; unresolvable references become `#REF!`. */
function rewriteFormula(formula, axis, mode, at) {
  return formula.replace(RANGE_OR_CELL_PATTERN, (whole, rangeStart, rangeEnd) => {
    if (rangeStart === undefined) {
      const position = parseCellName(whole);
      if (!position) return whole;
      const mapped = mapPosition(axis, mode, at, position);
      return mapped ? cellName(mapped.row, mapped.column) : "#REF!";
    }
    const from = parseCellName(rangeStart);
    const to = parseCellName(rangeEnd);
    if (!from || !to) return whole;
    const mapped = mapRectangle(axis, mode, at, from, to);
    if (isCollapsed(mapped)) return "#REF!";
    return `${cellName(mapped.top, mapped.left)}:${cellName(mapped.bottom, mapped.right)}`;
  });
}

function shiftCells(cells, axis, mode, at) {
  const next = {};
  for (const [coordinate, raw] of Object.entries(cells)) {
    const position = parseCellName(coordinate);
    if (!position) continue;
    const mapped = mapPosition(axis, mode, at, position);
    if (!mapped) continue;
    next[cellName(mapped.row, mapped.column)] = raw.startsWith("=")
      ? rewriteFormula(raw, axis, mode, at)
      : raw;
  }
  return next;
}

/** Inserts a blank row at `index`; that row and everything below shifts down. */
export function insertRow(cells, index) {
  return shiftCells(cells, ROW_AXIS, "insert-before", index);
}

/** Deletes the row at `index`; everything below shifts up. */
export function deleteRow(cells, index) {
  return shiftCells(cells, ROW_AXIS, "delete", index);
}

/** Inserts a blank column at `index`; that column and everything right shifts right. */
export function insertColumn(cells, index) {
  return shiftCells(cells, COLUMN_AXIS, "insert-before", index);
}

/** Deletes the column at `index`; everything right shifts left. */
export function deleteColumn(cells, index) {
  return shiftCells(cells, COLUMN_AXIS, "delete", index);
}

/**
 * Moves an A1 area with its cells, returning the new area text. `null` means
 * the deleted line covered the whole area, so nothing is left to constrain.
 */
export function shiftArea(range, axis, mode, at) {
  const bounds = parseArea(range);
  if (!bounds) return null;
  const mapped = mapRectangle(
    axis,
    mode,
    at,
    { row: bounds.top, column: bounds.left },
    { row: bounds.bottom, column: bounds.right },
  );
  if (isCollapsed(mapped)) return null;
  const start = cellName(mapped.top, mapped.left);
  const end = cellName(mapped.bottom, mapped.right);
  return start === end ? start : `${start}:${end}`;
}

/**
 * Validation rules after a row/column change: each rule's range follows the
 * cells it constrains, and a rule completely covered by a deleted line is
 * dropped. Keeps numeric limits and dropdown cells attached to their data.
 */
export function shiftRuleRanges(rules, { axis, mode, index }) {
  if (!Array.isArray(rules) || rules.length === 0) return rules;
  const at = mode === "insert-after" ? index + 1 : index;
  const change = mode === "delete" ? "delete" : "insert-before";
  const next = [];
  for (const rule of rules) {
    const range = shiftArea(rule?.range, axis, change, at);
    if (!range) continue;
    next.push({ ...rule, range });
  }
  return next;
}

/**
 * Cell notes after a row/column change: every note follows the cell it is
 * attached to, and a note whose cell is covered by a deleted line disappears
 * with that cell. The note texts themselves are never modified.
 */
export function shiftNotes(notes, { axis, mode, index }) {
  if (!notes || typeof notes !== "object") return notes;
  const at = mode === "insert-after" ? index + 1 : index;
  const change = mode === "delete" ? "delete" : "insert-before";
  const next = {};
  for (const [coordinate, text] of Object.entries(notes)) {
    const position = parseCellName(coordinate);
    if (!position) continue;
    const mapped = mapPosition(axis, change, at, position);
    if (!mapped) continue;
    next[cellName(mapped.row, mapped.column)] = text;
  }
  return next;
}

/**
 * Pivot table of a result worksheet after its source worksheet changed rows or
 * columns: the stored source range follows its cells, so a later refresh reads
 * the moved data instead of the old coordinates. `null` means the deleted line
 * covered the whole range, so the caller keeps the last stored range.
 */
export function shiftPivot(pivot, { axis, mode, index }) {
  if (!pivot || typeof pivot !== "object") return pivot;
  const at = mode === "insert-after" ? index + 1 : index;
  const change = mode === "delete" ? "delete" : "insert-before";
  const range = shiftArea(pivot.range, axis, change, at);
  if (!range) return null;
  return { ...pivot, range };
}

/**
 * Filter view after a row/column change: the filtered range and each column
 * index follow their cells, and a column whose header was deleted is dropped.
 * `null` means the whole filtered region is gone.
 */
export function shiftFilter(filter, { axis, mode, index }) {
  if (!filter || typeof filter !== "object") return filter;
  const at = mode === "insert-after" ? index + 1 : index;
  const change = mode === "delete" ? "delete" : "insert-before";
  const range = shiftArea(filter.range, axis, change, at);
  if (!range) return null;
  const columns = (Array.isArray(filter.columns) ? filter.columns : []).flatMap((column) => {
    if (axis !== COLUMN_AXIS) return [column];
    const mapped = mapPosition(COLUMN_AXIS, change, at, { row: 1, column: column.column });
    return mapped ? [{ ...column, column: mapped.column }] : [];
  });
  return { ...filter, range, columns };
}

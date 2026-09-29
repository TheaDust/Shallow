/**
 * Row/column structure operations of a worksheet.
 *
 * The stored `cells` record is the single source of truth: inserting a row or
 * column shifts every raw value of the target coordinate and everything after
 * it along the axis (the grid has a fixed size, so values pushed past the last
 * row/column are dropped), deleting drops the target line and pulls the
 * following lines back. Formula text shifts together with the cells so a
 * formula keeps pointing at the same data; references that cannot be preserved
 * become `#REF!`. `rewriteFormulaReferences` is the shared entry point: range
 * transfer (REQ-3-2-1) rewrites the same reference syntax by a target offset.
 */

import { cellAddress, columnLabel, parseCellAddress } from "./coordinates.mjs";

export const GRID_ROW_COUNT = 40;
export const GRID_COLUMN_COUNT = 20;

export const INSERT_ROW_ABOVE = "insert-row-above";
export const INSERT_ROW_BELOW = "insert-row-below";
export const DELETE_ROW = "delete-row";
export const INSERT_COLUMN_LEFT = "insert-column-left";
export const INSERT_COLUMN_RIGHT = "insert-column-right";
export const DELETE_COLUMN = "delete-column";

export const ROW_OPERATIONS = Object.freeze([INSERT_ROW_ABOVE, INSERT_ROW_BELOW, DELETE_ROW]);
export const COLUMN_OPERATIONS = Object.freeze([
  INSERT_COLUMN_LEFT,
  INSERT_COLUMN_RIGHT,
  DELETE_COLUMN,
]);

export const INVALID_ROW_MESSAGE = "Invalid row number";
export const INVALID_COLUMN_MESSAGE = "Invalid column";
export const UNKNOWN_ROW_OPERATION_MESSAGE = "Unknown row operation";
export const UNKNOWN_COLUMN_OPERATION_MESSAGE = "Unknown column operation";

export const REF_ERROR = "#REF!";

/** One A1 endpoint of a (possibly qualified, possibly ranged) reference. */
const ENDPOINT_PATTERN = /^(\$?)([A-Za-z]{1,3})(\$?)([0-9]{1,7})$/;
/** Reference inside formula text: optional `Sheet!` qualifier plus one or two endpoints. */
const REFERENCE_PATTERN = /(?:('(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(\$?[A-Za-z]{1,3}\$?[0-9]{1,7})(?::(\$?[A-Za-z]{1,3}\$?[0-9]{1,7}))?(?!\s*\()/g;

function axisLimit(axis) {
  return axis === "row" ? GRID_ROW_COUNT : GRID_COLUMN_COUNT;
}

/** Validates a 1-based row number, returning the number or null. */
export function normalizeRowIndex(value) {
  const row = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isInteger(row) || row < 1 || row > GRID_ROW_COUNT) return null;
  return row;
}

/** Validates a 1-based column number or letter (`B`), returning the number or null. */
export function normalizeColumnIndex(value) {
  if (typeof value === "string" && /^[A-Za-z]{1,3}$/.test(value.trim())) {
    const parsed = parseCellAddress(`${value.trim()}1`);
    if (!parsed || parsed.column > GRID_COLUMN_COUNT) return null;
    return parsed.column;
  }
  const column = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isInteger(column) || column < 1 || column > GRID_COLUMN_COUNT) return null;
  return column;
}

/**
 * How one axis changes: `from` is the first source line that moves, `delta` the
 * shift amount and `removed` the deleted line (null on insertions).
 */
function shiftPlan(axis, operation, index) {
  const insertBefore = axis === "row" ? INSERT_ROW_ABOVE : INSERT_COLUMN_LEFT;
  const insertAfter = axis === "row" ? INSERT_ROW_BELOW : INSERT_COLUMN_RIGHT;
  if (operation === insertBefore) return { from: index, delta: 1, removed: null };
  if (operation === insertAfter) return { from: index + 1, delta: 1, removed: null };
  return { from: index, delta: -1, removed: index };
}

/** Destination line of one source line, or null when it leaves the axis. */
function mapLine(value, plan, limit) {
  if (plan.removed !== null && value === plan.removed) return null;
  const moved = value >= plan.from ? value + plan.delta : value;
  if (moved < 1 || moved > limit) return null;
  return moved;
}

function parseEndpoint(text) {
  const match = ENDPOINT_PATTERN.exec(text);
  if (!match) return null;
  const [, columnDollar, letters, rowDollar, digits] = match;
  const column = parseCellAddress(`${letters}1`)?.column;
  const row = Number(digits);
  if (!column || !Number.isInteger(row)) return null;
  return { columnDollar, letters, rowDollar, digits, column, row };
}

function renderEndpoint(endpoint, axis, line) {
  return axis === "row"
    ? `${endpoint.columnDollar}${endpoint.letters}${endpoint.rowDollar}${line}`
    : `${endpoint.columnDollar}${columnLabel(line)}${endpoint.rowDollar}${endpoint.digits}`;
}

/**
 * Shifts one A1 endpoint, or returns null when the reference cannot survive.
 * `isRangeStart` keeps the start of a range on the line that moved into a
 * deleted position, so a range only shrinks instead of breaking.
 */
function shiftEndpoint(text, axis, plan, isRangeStart) {
  const endpoint = parseEndpoint(text);
  if (!endpoint) return null;
  const line = axis === "row" ? endpoint.row : endpoint.column;
  if (plan.removed !== null && line === plan.removed) {
    if (!isRangeStart) return null;
    return renderEndpoint(endpoint, axis, line);
  }
  const shifted = line >= plan.from ? line + plan.delta : line;
  return renderEndpoint(endpoint, axis, shifted);
}

function shiftReference(first, second, axis, plan) {
  if (second === undefined) return shiftEndpoint(first, axis, plan, false);
  const start = shiftEndpoint(first, axis, plan, true);
  const end = shiftEndpoint(second, axis, plan, false);
  if (start === null || end === null) return null;
  const startLine = axis === "row" ? parseEndpoint(start).row : parseEndpoint(start).column;
  const endLine = axis === "row" ? parseEndpoint(end).row : parseEndpoint(end).column;
  if (startLine > endLine) return null;
  return `${start}:${end}`;
}

/** Sheet name of a reference qualifier (`Sheet1!`, `'Q3 Sales'!`), without quotes. */
function unquoteSheetName(prefix) {
  const raw = String(prefix ?? "").replace(/\s*!$/, "");
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
  return raw;
}

/**
 * True when a reference qualifier (`Sheet1!`) points at the given worksheet. A
 * reference without qualifier always belongs to the worksheet that holds it.
 * Foreign worksheets are left alone by every rewrite, so a formula never
 * silently follows data that lives somewhere else.
 */
export function qualifierMatchesSheet(sheetPrefix, worksheetName) {
  if (!sheetPrefix) return true;
  return unquoteSheetName(sheetPrefix).toLowerCase() === String(worksheetName ?? "").toLowerCase();
}

/**
 * Rewrites every A1 reference of one formula, leaving quoted literals and
 * foreign-sheet qualifiers to `rewrite`. The callback receives one match
 * (`{ sheetPrefix, first, second, match }`) and returns the replacement text,
 * the original `match` to keep it, or `null` for a reference that cannot
 * survive (rendered as `#REF!`).
 */
export function rewriteFormulaReferences(text, rewrite) {
  const parts = String(text).split('"');
  for (let index = 0; index < parts.length; index += 2) {
    parts[index] = parts[index].replace(
      new RegExp(REFERENCE_PATTERN.source, "g"),
      (match, sheetPrefix, first, second) => {
        const replaced = rewrite({ sheetPrefix, first, second, match });
        return replaced === null ? REF_ERROR : replaced;
      },
    );
  }
  return parts.join('"');
}

/** Rewrites every reference of a formula, leaving quoted literals untouched. */
export function shiftFormulaText(text, axis, plan, worksheetName) {
  return rewriteFormulaReferences(text, ({ sheetPrefix, first, second, match }) => (
    qualifierMatchesSheet(sheetPrefix, worksheetName) ? shiftReference(first, second, axis, plan) : match
  ));
}

function shiftCells(cells, axis, plan, worksheetName) {
  const limit = axisLimit(axis);
  const shifted = {};
  for (const [address, raw] of Object.entries(cells)) {
    const coordinate = parseCellAddress(address);
    if (!coordinate) {
      shifted[address] = raw;
      continue;
    }
    const target = mapLine(axis === "row" ? coordinate.row : coordinate.column, plan, limit);
    if (target === null) continue;
    const nextAddress = axis === "row"
      ? cellAddress(coordinate.column, target)
      : cellAddress(target, coordinate.row);
    shifted[nextAddress] = typeof raw === "string" && raw.startsWith("=")
      ? shiftFormulaText(raw, axis, plan, worksheetName)
      : raw;
  }
  return shifted;
}

/** One validation-range endpoint after the shift, or null when it leaves the grid. */
function shiftValidationEndpoint(address, axis, plan) {
  const coordinate = parseCellAddress(address);
  if (!coordinate) return null;
  const line = axis === "row" ? coordinate.row : coordinate.column;
  const shifted = plan.removed !== null && line === plan.removed
    ? line
    : line >= plan.from
      ? line + plan.delta
      : line;
  if (shifted < 1 || shifted > axisLimit(axis)) return null;
  return axis === "row"
    ? cellAddress(coordinate.column, shifted)
    : cellAddress(shifted, coordinate.row);
}

function lineOf(address, axis) {
  const coordinate = parseCellAddress(address);
  if (!coordinate) return null;
  return axis === "row" ? coordinate.row : coordinate.column;
}

/**
 * Shifts the ranges of the validation rules together with the data. A rule
 * whose whole range was deleted is dropped; a rule that only loses one of its
 * boundary lines shrinks to the remaining lines.
 */
function shiftValidationRules(validations, axis, plan) {
  const rules = Array.isArray(validations) ? validations : [];
  const shifted = [];
  for (const rule of rules) {
    if (!rule?.range) continue;
    const start = shiftValidationEndpoint(rule.range.start, axis, plan);
    const end = shiftValidationEndpoint(rule.range.end, axis, plan);
    if (!start || !end) continue;
    const startLine = lineOf(start, axis);
    const endLine = lineOf(end, axis);
    if (startLine === null || endLine === null || startLine > endLine) continue;
    if (
      plan.removed !== null
      && lineOf(rule.range.start, axis) === plan.removed
      && lineOf(rule.range.end, axis) === plan.removed
    ) {
      continue;
    }
    shifted.push({ ...rule, range: { start, end } });
  }
  return shifted;
}

/**
 * Shifts the data region of a filter together with the data. The range moves
 * like a validation range (a fully deleted region removes the filter, a region
 * that only loses a boundary line shrinks) and every filtered column follows
 * its own column, so a condition keeps constraining the same data.
 */
function shiftFilter(filter, axis, plan) {
  if (!filter || !filter.range) return null;
  const start = shiftValidationEndpoint(filter.range.start, axis, plan);
  const end = shiftValidationEndpoint(filter.range.end, axis, plan);
  if (!start || !end) return null;
  const startLine = lineOf(start, axis);
  const endLine = lineOf(end, axis);
  if (startLine === null || endLine === null || startLine > endLine) return null;
  if (
    plan.removed !== null
    && lineOf(filter.range.start, axis) === plan.removed
    && lineOf(filter.range.end, axis) === plan.removed
  ) {
    return null;
  }
  const columns = {};
  for (const [key, column] of Object.entries(filter.columns ?? {})) {
    const coordinate = parseCellAddress(`${key}1`);
    if (!coordinate) continue;
    const target = mapLine(axis === "row" ? coordinate.row : coordinate.column, plan, axisLimit(axis));
    if (target === null) continue;
    columns[axis === "row" ? key : columnLabel(target)] = column;
  }
  return { range: { start, end }, columns };
}

function applyOperation(worksheet, axis, operations, operation, index) {
  const unknown = axis === "row" ? UNKNOWN_ROW_OPERATION_MESSAGE : UNKNOWN_COLUMN_OPERATION_MESSAGE;
  const invalid = axis === "row" ? INVALID_ROW_MESSAGE : INVALID_COLUMN_MESSAGE;
  if (!operations.includes(operation)) return { ok: false, error: unknown };
  if (!Number.isInteger(index) || index < 1 || index > axisLimit(axis)) {
    return { ok: false, error: invalid };
  }
  const plan = shiftPlan(axis, operation, index);
  const shifted = shiftCells(worksheet.cells, axis, plan, worksheet.name);
  worksheet.cells = shifted;
  worksheet.validations = shiftValidationRules(worksheet.validations, axis, plan);
  worksheet.filter = shiftFilter(worksheet.filter, axis, plan);
  return { ok: true };
}

/**
 * Applies a row operation in place: `insert-row-above`, `insert-row-below` or
 * `delete-row` at the 1-based `row`. Returns `{ ok: true }`, or `{ ok: false,
 * error }` without touching the worksheet when the operation is rejected.
 */
export function applyRowOperation(worksheet, operation, row) {
  return applyOperation(worksheet, "row", ROW_OPERATIONS, operation, row);
}

/** Column counterpart of `applyRowOperation` (`insert-column-left`/`right`, `delete-column`). */
export function applyColumnOperation(worksheet, operation, column) {
  return applyOperation(worksheet, "column", COLUMN_OPERATIONS, operation, column);
}

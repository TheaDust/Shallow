/**
 * Row filters of a worksheet (REQ-5-1-2).
 *
 * A filter owns the rectangular `range` of the data region it was created for
 * (its first row holds the headers) plus one entry per filtered column. A
 * column entry either keeps a set of allowed source `values` or a `condition`
 * (text contains / greater than / before / is empty / is not empty). Filtering
 * never changes the stored cells: `filterHiddenRows` only reports which data
 * rows of the range do not match, so clear-filter restores the original records
 * untouched and export/pivot keep seeing every source row.
 *
 * Entries of different columns are combined with AND.
 */

import { cellAddress, parseCellAddress } from "./coordinates.mjs";
import { normalizeValidationRange } from "./validation.mjs";

export const INVALID_FILTER_MESSAGE = "Invalid filter";

export const FILTER_CONDITION = "condition";
export const FILTER_VALUES = "values";

export const TEXT_CONTAINS = "text-contains";
export const GREATER_THAN = "greater-than";
export const BEFORE = "before";
export const IS_EMPTY = "is-empty";
export const IS_NOT_EMPTY = "is-not-empty";

/** Condition operators in the order the "Condition" combo box offers them. */
export const FILTER_OPERATORS = Object.freeze([TEXT_CONTAINS, GREATER_THAN, BEFORE, IS_EMPTY, IS_NOT_EMPTY]);

/** Visible name of every condition operator, i.e. the option names of "Condition". */
export const FILTER_OPERATOR_LABELS = Object.freeze({
  [TEXT_CONTAINS]: "Text contains",
  [GREATER_THAN]: "Greater than",
  [BEFORE]: "Before",
  [IS_EMPTY]: "Is empty",
  [IS_NOT_EMPTY]: "Is not empty",
});

/** Operators that read the "Value" text box; the remaining ones need no value. */
export const VALUE_OPERATORS = Object.freeze([TEXT_CONTAINS, GREATER_THAN, BEFORE]);

export function operatorNeedsValue(operator) {
  return VALUE_OPERATORS.includes(operator);
}

/** Normalizes one column entry, or returns null when it cannot be enforced. */
function normalizeColumn(input) {
  if (!input || typeof input !== "object") return null;
  if (input.kind === FILTER_VALUES) {
    if (!Array.isArray(input.values)) return null;
    const values = [];
    for (const value of input.values) {
      if (typeof value !== "string") return null;
      if (!values.includes(value)) values.push(value);
    }
    return { kind: FILTER_VALUES, values };
  }
  if (input.kind === FILTER_CONDITION) {
    if (!FILTER_OPERATORS.includes(input.operator)) return null;
    if (!operatorNeedsValue(input.operator)) return { kind: FILTER_CONDITION, operator: input.operator, value: "" };
    if (typeof input.value !== "string" || input.value.trim() === "") return null;
    return { kind: FILTER_CONDITION, operator: input.operator, value: input.value.trim() };
  }
  return null;
}

/**
 * Normalizes a submitted filter (`null` removes it). Returns
 * `{ ok: true, filter }` or `{ ok: false, error }`; nothing is stored when a
 * range, a column key or a column entry cannot be used.
 */
export function normalizeFilter(input) {
  if (input === null || typeof input === "undefined") return { ok: true, filter: null };
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, error: INVALID_FILTER_MESSAGE };
  const range = normalizeValidationRange(input.range);
  if (!range) return { ok: false, error: INVALID_FILTER_MESSAGE };
  const start = parseCellAddress(range.start);
  const end = parseCellAddress(range.end);
  if (!start || !end) return { ok: false, error: INVALID_FILTER_MESSAGE };
  const rawColumns = input.columns ?? {};
  if (typeof rawColumns !== "object" || Array.isArray(rawColumns)) {
    return { ok: false, error: INVALID_FILTER_MESSAGE };
  }
  const columns = {};
  for (const [key, value] of Object.entries(rawColumns)) {
    const coordinate = parseCellAddress(`${key}1`);
    if (!coordinate || coordinate.column < start.column || coordinate.column > end.column) {
      return { ok: false, error: INVALID_FILTER_MESSAGE };
    }
    const column = normalizeColumn(value);
    if (!column) return { ok: false, error: INVALID_FILTER_MESSAGE };
    columns[key.trim().toUpperCase()] = column;
  }
  return { ok: true, filter: { range, columns } };
}

/** True when one displayed cell text satisfies one column entry. */
export function columnMatches(text, column) {
  const value = typeof text === "string" ? text : "";
  if (!column || typeof column !== "object") return true;
  if (column.kind === FILTER_VALUES) {
    const allowed = Array.isArray(column.values) ? column.values : [];
    return allowed.includes(value);
  }
  switch (column.operator) {
    case TEXT_CONTAINS:
      return value.toLowerCase().includes(String(column.value ?? "").toLowerCase());
    case GREATER_THAN: {
      const cell = parseNumber(value);
      const boundary = parseNumber(column.value);
      return cell !== null && boundary !== null && cell > boundary;
    }
    case BEFORE: {
      const cell = parseDate(value);
      const boundary = parseDate(column.value);
      return cell !== null && boundary !== null && cell < boundary;
    }
    case IS_EMPTY:
      return value.trim() === "";
    case IS_NOT_EMPTY:
      return value.trim() !== "";
    default:
      return true;
  }
}

function parseNumber(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "") return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

function parseDate(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "") return null;
  const stamp = Date.parse(trimmed);
  return Number.isNaN(stamp) ? null : stamp;
}

/**
 * Grid rows the filter of a worksheet hides: the data rows of the filter range
 * (every row after its header line) that fail at least one column entry. The
 * header row and everything outside the range stay visible. Rows keep their
 * stored values and their position, so clearing the filter shows them again.
 */
export function filterHiddenRows(filter, values, cells) {
  if (!filter || !filter.range) return [];
  const start = parseCellAddress(filter.range.start);
  const end = parseCellAddress(filter.range.end);
  if (!start || !end) return [];
  const columns = Object.entries(filter.columns ?? {});
  if (columns.length === 0) return [];
  const display = values && typeof values === "object" ? values : {};
  const raw = cells && typeof cells === "object" ? cells : {};
  const hidden = [];
  for (let row = start.row + 1; row <= end.row; row += 1) {
    const matches = columns.every(([key, column]) => {
      const coordinate = parseCellAddress(`${key}1`);
      if (!coordinate) return true;
      const address = cellAddress(coordinate.column, row);
      return columnMatches(display[address] ?? raw[address] ?? "", column);
    });
    if (!matches) hidden.push(row);
  }
  return hidden;
}

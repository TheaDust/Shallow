/**
 * Filter views of one worksheet.
 *
 * A filter is stored on the worksheet as
 * `{ range: "A1:C4", columns: [{ column: "A", mode: "values" | "condition", values?, condition?,
 * value? }] }` so it survives a restart. The first row of `range` is the header row: it names
 * the region and never disappears. A filter never changes data — rows whose values do not
 * match stay in `cells`/`values` and are only reported as hidden (`hiddenRows`), so sorting,
 * CSV export, pivot sources and formula results keep seeing every source record. Conditions of
 * different columns are combined with AND.
 */

import { cellAddress } from "./address.mjs";

export const FILTER_INVALID_MESSAGE = "Invalid filter";

/** Conditions a column filter understands, in the order the dialog lists them. */
export const FILTER_CONDITIONS = [
  "text-contains",
  "greater-than",
  "before",
  "is-empty",
  "is-not-empty",
];

const RANGE_PATTERN = /^([A-Za-z]+)([1-9]\d*)(?::([A-Za-z]+)([1-9]\d*))?$/;

/** 1-based column number of A1 letters. */
function columnIndex(letters) {
  let column = 0;
  for (const letter of letters.toUpperCase()) column = column * 26 + (letter.charCodeAt(0) - 64);
  return column;
}

/** Bounds of an A1 rectangle (`A1:C4`), or null when it is not a usable range. */
export function filterBounds(range) {
  const match = RANGE_PATTERN.exec(String(range ?? "").trim());
  if (!match) return null;
  const rows = [Number(match[2]), Number(match[4] ?? match[2])];
  const columns =
    match[3] === undefined
      ? [columnIndex(match[1])]
      : [columnIndex(match[1]), columnIndex(match[3])];
  return {
    top: Math.min(...rows),
    bottom: Math.max(...rows),
    left: Math.min(...columns),
    right: Math.max(...columns),
  };
}

function normalizeColumnFilter(entry, bounds) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  if (typeof entry.column !== "string") return null;
  const column = entry.column.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(column)) return null;
  const index = columnIndex(column);
  if (index < bounds.left || index > bounds.right) return null;
  if (entry.mode === "values") {
    if (!Array.isArray(entry.values)) return null;
    const values = [];
    for (const value of entry.values) {
      if (typeof value !== "string") return null;
      if (!values.includes(value)) values.push(value);
    }
    return { column, mode: "values", values };
  }
  if (entry.mode === "condition") {
    if (!FILTER_CONDITIONS.includes(entry.condition)) return null;
    if (entry.value !== undefined && typeof entry.value !== "string") return null;
    return { column, mode: "condition", condition: entry.condition, value: entry.value ?? "" };
  }
  return null;
}

/**
 * Normalizes a submitted filter, or reports why it cannot be used.
 * @returns {{ ok: true, filter: object } | { ok: false, error: string }}
 */
export function normalizeFilter(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: FILTER_INVALID_MESSAGE };
  }
  const bounds = filterBounds(payload.range);
  if (!bounds) return { ok: false, error: FILTER_INVALID_MESSAGE };
  if (!Array.isArray(payload.columns)) return { ok: false, error: FILTER_INVALID_MESSAGE };
  const columns = [];
  for (const entry of payload.columns) {
    const normalized = normalizeColumnFilter(entry, bounds);
    if (!normalized) return { ok: false, error: FILTER_INVALID_MESSAGE };
    // One filter per column; a later entry replaces an earlier one.
    const existing = columns.findIndex((item) => item.column === normalized.column);
    if (existing >= 0) columns[existing] = normalized;
    else columns.push(normalized);
  }
  const range = `${cellAddress(bounds.top - 1, bounds.left - 1)}:${cellAddress(
    bounds.bottom - 1,
    bounds.right - 1,
  )}`;
  return { ok: true, filter: { range, columns } };
}

/** True when one displayed cell text satisfies `condition` with the dialog's operand. */
export function matchesFilterCondition(text, condition, value) {
  const source = String(text ?? "");
  const operand = String(value ?? "").trim();
  if (condition === "text-contains") return source.toLowerCase().includes(operand.toLowerCase());
  if (condition === "greater-than") {
    const cell = Number(source.trim());
    const limit = Number(operand);
    return Number.isFinite(cell) && Number.isFinite(limit) && cell > limit;
  }
  if (condition === "before") {
    const cell = Date.parse(source.trim());
    const limit = Date.parse(operand);
    return Number.isFinite(cell) && Number.isFinite(limit) && cell < limit;
  }
  if (condition === "is-empty") return source.trim() === "";
  if (condition === "is-not-empty") return source.trim() !== "";
  return true;
}

function columnFilterMatches(text, columnFilter) {
  if (columnFilter?.mode === "values") return (columnFilter.values ?? []).includes(text);
  if (columnFilter?.mode === "condition") {
    return matchesFilterCondition(text, columnFilter.condition, columnFilter.value);
  }
  return true;
}

/** Displayed text of one cell: the calculated value first, the submitted text otherwise. */
export function cellDisplayText(sheet, values, address) {
  const key = String(address).toUpperCase();
  return String(values?.[key] ?? sheet?.cells?.[key] ?? "");
}

/**
 * 1-based row numbers the filter hides: the data rows of its range (header row excluded) with
 * at least one column whose value does not match. Rows outside the filter range are never hidden.
 */
export function computeHiddenRows(sheet, values) {
  const filter = sheet?.filter;
  if (!filter) return [];
  const bounds = filterBounds(filter.range);
  if (!bounds) return [];
  const columns = Array.isArray(filter.columns) ? filter.columns : [];
  if (columns.length === 0) return [];
  const hidden = [];
  for (let row = bounds.top + 1; row <= bounds.bottom; row += 1) {
    for (const columnFilter of columns) {
      const address = cellAddress(row - 1, columnIndex(columnFilter.column) - 1);
      if (!columnFilterMatches(cellDisplayText(sheet, values, address), columnFilter)) {
        hidden.push(row);
        break;
      }
    }
  }
  return hidden;
}

/**
 * Row filters for a worksheet.
 *
 * A filter covers a rectangular region whose first row holds the headers
 * (`range.minRow`) and whose remaining rows are the records. It carries one
 * column filter per constrained column:
 *
 * - `values`: the record matches when its displayed value is one of the listed
 *   source values,
 * - `condition`: the record matches when its displayed value satisfies one of
 *   the named conditions (`Text contains`, `Greater than`, `Before`,
 *   `Is empty`, `Is not empty`).
 *
 * Conditions on different columns are combined with AND. A filter never
 * rewrites the worksheet: the store keeps the filter description and the grid
 * derives which rows stay visible, so hidden rows keep their values, their
 * order and their place in every other view (CSV export, pivot sources).
 */

export const CONDITION_OPERATORS = ["contains", "greaterThan", "before", "isEmpty", "isNotEmpty"];

const VALUE_FILTER_KIND = "values";
const CONDITION_FILTER_KIND = "condition";

function isGridRange(range, rowCount, columnCount) {
  return (
    range !== null &&
    typeof range === "object" &&
    Number.isInteger(range.minRow) &&
    Number.isInteger(range.maxRow) &&
    Number.isInteger(range.minCol) &&
    Number.isInteger(range.maxCol) &&
    range.minRow >= 0 &&
    range.minCol >= 0 &&
    range.minRow <= range.maxRow &&
    range.minCol <= range.maxCol &&
    range.maxRow < rowCount &&
    range.maxCol < columnCount
  );
}

/** True when `raw` describes a usable filter range inside the given grid. */
export function isFilterRange(raw, rowCount, columnCount) {
  return isGridRange(raw, rowCount, columnCount);
}

/**
 * Normalizes one column filter, or null when it is malformed or sits outside
 * the filtered range.
 */
function normalizeColumnFilter(raw, range) {
  if (raw === null || typeof raw !== "object") return null;
  const col = raw.col;
  if (!Number.isInteger(col) || col < range.minCol || col > range.maxCol) return null;
  if (raw.kind === VALUE_FILTER_KIND) {
    if (!Array.isArray(raw.values) || !raw.values.every((value) => typeof value === "string")) {
      return null;
    }
    return { col, kind: VALUE_FILTER_KIND, values: [...raw.values] };
  }
  if (raw.kind === CONDITION_FILTER_KIND) {
    if (!CONDITION_OPERATORS.includes(raw.operator)) return null;
    if (typeof raw.value !== "string") return null;
    return { col, kind: CONDITION_FILTER_KIND, operator: raw.operator, value: raw.value };
  }
  return null;
}

/** Keeps only well-formed column filters, one per column (the last one wins). */
export function normalizeColumnFilters(raw, range) {
  if (!Array.isArray(raw)) return [];
  const byColumn = new Map();
  for (const entry of raw) {
    const filter = normalizeColumnFilter(entry, range);
    if (filter) byColumn.set(filter.col, filter);
  }
  return [...byColumn.values()].sort((a, b) => a.col - b.col);
}

/** The filter as stored, or null when the value cannot be used. */
export function normalizeFilter(raw, rowCount, columnCount) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || !isGridRange(raw.range, rowCount, columnCount)) return null;
  const range = {
    minRow: raw.range.minRow,
    maxRow: raw.range.maxRow,
    minCol: raw.range.minCol,
    maxCol: raw.range.maxCol,
  };
  return { range, columns: normalizeColumnFilters(raw.columns, range) };
}

/**
 * Strict check used by the API boundary: accepts `null` (no filter) or a
 * complete filter description. Returns `{ok: true, filter}` or
 * `{ok: false, error}` with a message explaining the rejection.
 */
export function validateFilterPayload(raw, worksheet) {
  if (raw === null || raw === undefined) return { ok: true, filter: null };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Invalid filter" };
  }
  if (!isGridRange(raw.range, worksheet.rowCount, worksheet.columnCount)) {
    return { ok: false, error: "Invalid filter range" };
  }
  const range = {
    minRow: raw.range.minRow,
    maxRow: raw.range.maxRow,
    minCol: raw.range.minCol,
    maxCol: raw.range.maxCol,
  };
  if (raw.columns !== undefined && !Array.isArray(raw.columns)) {
    return { ok: false, error: "Invalid filter" };
  }
  const columnFilters = normalizeColumnFilters(raw.columns, range);
  if (Array.isArray(raw.columns) && columnFilters.length !== raw.columns.length) {
    return { ok: false, error: "Invalid filter" };
  }
  return { ok: true, filter: { range, columns: columnFilters } };
}

import { parseRegionRef } from "./cells.mjs";
import { WorkbookError } from "./errors.mjs";

/**
 * Filter view of one worksheet. A filter belongs to one rectangular region with a header row and
 * stores one optional column filter per column of that region: either a set of selected source
 * values or a condition. Filtering only hides rows of the region; the cells themselves are never
 * deleted or reordered, so exports and pivot summaries still read every record.
 */

export const FILTER_CONDITIONS = Object.freeze([
  "textContains",
  "greaterThan",
  "before",
  "isEmpty",
  "isNotEmpty",
]);

/** Conditions that compare the cell text against the `Value` box of the dialog. */
export const VALUE_CONDITIONS = Object.freeze(["textContains", "greaterThan", "before"]);

export function isFilterCondition(value) {
  return FILTER_CONDITIONS.includes(value);
}

function normalizeColumnFilter(raw, region) {
  const column = Number(raw?.column);
  if (!Number.isInteger(column) || column < region.left || column > region.right) {
    throw new WorkbookError("The filtered column is outside the filtered range");
  }
  const kind = String(raw?.kind ?? "");
  if (kind === "values") {
    const requested = Array.isArray(raw?.selected) ? raw.selected : [];
    const selected = [];
    for (const value of requested) {
      const text = typeof value === "string" ? value : String(value ?? "");
      if (!selected.includes(text)) selected.push(text);
    }
    return { column, kind: "values", selected };
  }
  if (kind === "condition") {
    const condition = String(raw?.condition ?? "");
    if (!isFilterCondition(condition)) throw new WorkbookError("Unknown filter condition");
    const value = VALUE_CONDITIONS.includes(condition) ? String(raw?.value ?? "").trim() : "";
    return { column, kind: "condition", condition, value };
  }
  throw new WorkbookError("Unknown filter type");
}

/** Normalizes the payload of the filter write endpoint into the stored filter view. */
export function normalizeFilter(payload) {
  const region = parseRegionRef(payload?.region);
  if (!region) throw new WorkbookError("Enter a valid range such as A1:B2");
  const requested = Array.isArray(payload?.columns) ? payload.columns : [];
  const byColumn = new Map();
  for (const raw of requested) {
    const column = normalizeColumnFilter(raw, region);
    byColumn.set(column.column, column);
  }
  const columns = [...byColumn.values()].sort((left, right) => left.column - right.column);
  return { region, columns };
}

/** Reads a filter stored in the state document; a record an older file left malformed is dropped. */
export function readStoredFilter(value) {
  if (!value || typeof value !== "object") return null;
  try {
    return normalizeFilter(value);
  } catch {
    return null;
  }
}

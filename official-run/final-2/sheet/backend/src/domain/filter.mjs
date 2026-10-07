/**
 * Filter views for worksheet ranges.
 *
 * A worksheet may carry a `filter` describing a rectangular region whose first
 * row holds the headers plus one rule per column. The rules are view state: rows
 * that do not satisfy every column rule are hidden, never deleted or reordered,
 * so exports and analysis still read the whole source range.
 *
 * A workbook additionally carries `filterViews`: named copies of such a filter,
 * saved so the same restriction can be chosen again later. Names are trimmed,
 * nonempty and unique within the workbook ignoring letter case. This module owns
 * the shared vocabulary and the payload normalization; the store persists it.
 */

import { ValidationError } from "../lib/errors.mjs";
import { normalizeRuleRange } from "./validation.mjs";

export const FILTER_CONDITIONS = ["Text contains", "Greater than", "Before", "Is empty", "Is not empty"];

export const INVALID_FILTER_MESSAGE = "Invalid filter";
export const EMPTY_FILTER_VIEW_NAME_MESSAGE = "Filter view name cannot be empty";
export const FILTER_VIEW_DUPLICATE_MESSAGE = "Filter view name already exists";
export const FILTER_VIEW_MISSING_MESSAGE = "Filter view not found";
export const FILTER_VIEW_NO_FILTER_MESSAGE = "Create a filter before saving a filter view";

/** Trimmed, nonempty filter-view name, or throws `ValidationError`. */
export function normalizeFilterViewName(value) {
  if (typeof value !== "string") throw new ValidationError(EMPTY_FILTER_VIEW_NAME_MESSAGE);
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError(EMPTY_FILTER_VIEW_NAME_MESSAGE);
  return trimmed;
}

/** Validated, canonical filter view, or throws `ValidationError`. */
export function normalizeFilter(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(INVALID_FILTER_MESSAGE);
  }
  let range;
  try {
    range = normalizeRuleRange(value.range);
  } catch {
    // A malformed area is a filter error here, not a rule error.
    throw new ValidationError(INVALID_FILTER_MESSAGE);
  }
  if (!Array.isArray(value.columns)) throw new ValidationError(INVALID_FILTER_MESSAGE);
  const columns = value.columns.map((column) => {
    if (column === null || typeof column !== "object" || Array.isArray(column)) {
      throw new ValidationError(INVALID_FILTER_MESSAGE);
    }
    const index = column.column;
    if (!Number.isInteger(index) || index < 1) throw new ValidationError(INVALID_FILTER_MESSAGE);
    const header = typeof column.header === "string" ? column.header : "";
    if (column.mode === "values") {
      const values = Array.isArray(column.values) ? column.values.map((entry) => String(entry)) : [];
      return { column: index, header, mode: "values", values };
    }
    if (column.mode === "condition") {
      if (!FILTER_CONDITIONS.includes(column.condition)) throw new ValidationError(INVALID_FILTER_MESSAGE);
      const text = typeof column.value === "string" ? column.value : "";
      return { column: index, header, mode: "condition", condition: column.condition, value: text };
    }
    throw new ValidationError(INVALID_FILTER_MESSAGE);
  });
  return { range, columns };
}

/**
 * Independent copy of a normalized filter, so a stored filter view and the
 * worksheet's applied filter never share mutable state.
 */
export function copyFilter(filter) {
  return {
    range: filter.range,
    columns: filter.columns.map((column) => ({
      ...column,
      values: Array.isArray(column.values) ? [...column.values] : undefined,
    })),
  };
}

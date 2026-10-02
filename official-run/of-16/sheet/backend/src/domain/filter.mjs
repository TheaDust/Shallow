/**
 * Persisted filter of one worksheet (REQ-5-1-2).
 *
 * A filter names a rectangular data region (its first row holds the headers)
 * plus one rule per constrained column. The rules only decide which rows are
 * *hidden* by the editor: they never move, delete or rewrite a value, so
 * clearing the filter restores the source records in their original order. The
 * rule is keyed by its header text, which keeps it attached to the right column
 * while the region's coordinates shift with row/column structure changes.
 *
 * Conditions of different columns are combined with AND by the client; the
 * server only stores the normalized rules.
 */
import { DomainError } from "./errors.mjs";
import { parseRange } from "./validation.mjs";

export const FILTER_CONDITIONS = Object.freeze([
  "text-contains",
  "greater-than",
  "before",
  "is-empty",
  "is-not-empty",
]);

/** True for the conditions that compare against the `Value` text box. */
export const VALUE_CONDITIONS = Object.freeze(["text-contains", "greater-than", "before"]);

function normalizedRange(rawRange) {
  const range = typeof rawRange === "string" ? rawRange.trim().toUpperCase() : "";
  if (!parseRange(range)) throw new DomainError(`Invalid filter range: ${rawRange}`, 400);
  return range;
}

function normalizeRule(rule) {
  const header = typeof rule?.header === "string" ? rule.header.trim() : "";
  if (!header) throw new DomainError("A filter rule needs a column header", 400);
  if (rule?.type === "values") {
    if (!Array.isArray(rule.values)) throw new DomainError("A value filter needs the selected values", 400);
    return { header, type: "values", values: rule.values.map((value) => String(value)) };
  }
  if (rule?.type === "condition") {
    if (!FILTER_CONDITIONS.includes(rule.condition)) {
      throw new DomainError(`Unknown filter condition: ${rule.condition}`, 400);
    }
    const next = { header, type: "condition", condition: rule.condition };
    if (VALUE_CONDITIONS.includes(rule.condition)) {
      next.value = typeof rule.value === "string" ? rule.value : "";
    }
    return next;
  }
  throw new DomainError(`Unknown filter rule type: ${rule?.type}`, 400);
}

/**
 * Normalizes a filter payload. `null` is the explicit "no filter" state used by
 * "Clear filter"; anything malformed is rejected before the store is touched.
 */
export function normalizeFilter(input) {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object" || Array.isArray(input)) throw new DomainError("filter must be an object", 400);
  const range = normalizedRange(input.range);
  const rules = (Array.isArray(input.rules) ? input.rules : []).map((rule) => normalizeRule(rule));
  return { range, rules };
}

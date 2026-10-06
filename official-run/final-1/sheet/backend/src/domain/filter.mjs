/**
 * Filter views for worksheet ranges.
 *
 * A worksheet may carry a `filter` describing a rectangular region whose first
 * row holds the headers plus one rule per column. The rules are view state: rows
 * that do not satisfy every column rule are hidden, never deleted or reordered,
 * so exports and analysis still read the whole source range. This module only
 * owns the shared vocabulary; the store normalizes and persists the payload.
 */

export const FILTER_CONDITIONS = ["Text contains", "Greater than", "Before", "Is empty", "Is not empty"];

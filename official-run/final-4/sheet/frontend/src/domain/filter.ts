/**
 * Filter-view helpers for a data region with headers.
 *
 * A worksheet may carry a `filter` describing a rectangular region whose first
 * row holds the headers plus one rule per column. Rules only decide which rows
 * stay visible: the underlying cells are never deleted or reordered, so exports
 * and any analysis that reads the source range still see every record. Columns
 * are combined with AND, and a column with no rule (or no selected value)
 * accepts every row.
 *
 * This module is pure view logic; the authoritative persisted filter lives on
 * the server (`worksheet.filter`).
 */

import { areaOfRegion } from "./clipboard";
import { cellName, regionFromArea, type CellPosition, type CellRegion } from "./grid";
import type { FilterColumn, FilterConditionName, WorksheetFilter, WorksheetFilterView } from "./types";

/** Condition chosen when the dialog filters by values instead of a condition. */
export const NO_CONDITION = "";

/** Options of the dialog's "Condition" combo box, in display order. */
export const CONDITION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: NO_CONDITION, label: "No condition" },
  { value: "Text contains", label: "Text contains" },
  { value: "Greater than", label: "Greater than" },
  { value: "Before", label: "Before" },
  { value: "Is empty", label: "Is empty" },
  { value: "Is not empty", label: "Is not empty" },
];

const CONDITIONS: readonly string[] = ["Text contains", "Greater than", "Before", "Is empty", "Is not empty"];

export function isFilterCondition(value: string): value is FilterConditionName {
  return CONDITIONS.includes(value);
}

/** Conditions that need the dialog's "Value" text box; the empty tests do not. */
export function conditionNeedsValue(condition: string): boolean {
  return condition === "Text contains" || condition === "Greater than" || condition === "Before";
}

/** Saved filter views of a worksheet in stored order; absent means none. */
export function filterViewsOf(worksheet: { filterViews?: WorksheetFilterView[] }): WorksheetFilterView[] {
  return Array.isArray(worksheet.filterViews) ? worksheet.filterViews : [];
}

/**
 * True when two filters describe the same range and the same column rules.
 * Both sides are compared through their canonical JSON shape, so the saved
 * criteria of a view and the filter it applied count as the same filter.
 */
export function sameFilterCriteria(
  left: WorksheetFilter | null | undefined,
  right: WorksheetFilter | null | undefined,
): boolean {
  if (!left || !right) return false;
  return JSON.stringify({ range: left.range, columns: left.columns }) ===
    JSON.stringify({ range: right.range, columns: right.columns });
}

/**
 * Saved view whose criteria are exactly the filter currently applied, or
 * `null`. It drives the selected control of the "Filter views" interface.
 */
export function appliedFilterView(
  views: WorksheetFilterView[],
  filter: WorksheetFilter | null | undefined,
): WorksheetFilterView | null {
  if (!filter) return null;
  return views.find((view) => sameFilterCriteria(view, filter)) ?? null;
}

/** Rectangle of a filter's A1 range, or `null` when it is malformed. */
export function filterRegion(filter: WorksheetFilter | null | undefined): CellRegion | null {
  if (!filter || typeof filter.range !== "string") return null;
  return regionFromArea(filter.range);
}

/** First rule configured for `column`, or `null`. */
export function filterColumnFor(
  filter: WorksheetFilter | null | undefined,
  column: number,
): FilterColumn | null {
  if (!filter || !Array.isArray(filter.columns)) return null;
  return filter.columns.find((candidate) => candidate?.column === column) ?? null;
}

/** Distinct non-empty display values of one column of the filter's data rows. */
export function distinctColumnValues(
  values: Record<string, string>,
  filter: WorksheetFilter | null | undefined,
  column: number,
): string[] {
  const region = filterRegion(filter);
  if (!region) return [];
  const seen: string[] = [];
  for (let row = region.top + 1; row <= region.bottom; row += 1) {
    const text = values[cellName(row, column)] ?? "";
    if (text === "" || seen.includes(text)) continue;
    seen.push(text);
  }
  return seen;
}

/** True when one cell's display value satisfies one column rule. */
export function matchesColumnValue(value: string, rule: FilterColumn): boolean {
  if (rule.mode === "values") {
    const selected = Array.isArray(rule.values) ? rule.values : [];
    // No selected value means the column is not constrained.
    return selected.length === 0 || selected.includes(value);
  }
  const condition = rule.condition ?? NO_CONDITION;
  const needle = (rule.value ?? "").trim();
  switch (condition) {
    case "Text contains":
      return value.toLowerCase().includes(needle.toLowerCase());
    case "Greater than": {
      const actual = Number(value.trim());
      const limit = Number(needle);
      return Number.isFinite(actual) && Number.isFinite(limit) && actual > limit;
    }
    case "Before": {
      const actual = Date.parse(value.trim());
      const limit = Date.parse(needle);
      return Number.isFinite(actual) && Number.isFinite(limit) && actual < limit;
    }
    case "Is empty":
      return value.trim() === "";
    case "Is not empty":
      return value.trim() !== "";
    default:
      return true;
  }
}

/**
 * Rows of the filter's data area (everything below its header row) that do not
 * satisfy every column rule. Rows outside the filtered range are never hidden.
 */
export function hiddenRows(
  values: Record<string, string>,
  filter: WorksheetFilter | null | undefined,
): Set<number> {
  const hidden = new Set<number>();
  const region = filterRegion(filter);
  if (!region || !Array.isArray(filter?.columns) || filter.columns.length === 0) return hidden;
  const rules = filter.columns;
  for (let row = region.top + 1; row <= region.bottom; row += 1) {
    const matchesAll = rules.every((rule) =>
      matchesColumnValue(values[cellName(row, rule.column)] ?? "", rule),
    );
    if (!matchesAll) hidden.add(row);
  }
  return hidden;
}

/** Header cells (non-empty display texts of the top row) of a region, in order. */
export function headerColumns(
  values: Record<string, string>,
  region: CellRegion,
): Array<{ column: number; header: string }> {
  const columns: Array<{ column: number; header: string }> = [];
  for (let column = region.left; column <= region.right; column += 1) {
    const header = values[cellName(region.top, column)] ?? "";
    if (header !== "") columns.push({ column, header });
  }
  return columns;
}

/** Fresh, unconstrained filter view for a region's headers. */
export function emptyFilter(values: Record<string, string>, region: CellRegion): WorksheetFilter {
  const columns = headerColumns(values, region).map(({ column, header }) => ({
    column,
    header,
    mode: "values" as const,
    values: [] as string[],
  }));
  return { range: areaOfRegion(region), columns };
}

/**
 * Contiguous used region around `position`: it grows over adjacent cells that
 * hold data. Used when a filter is created with a single cell selected, so the
 * surrounding table (headers included) becomes the filtered region.
 */
export function dataRegionAround(values: Record<string, string>, position: CellPosition): CellRegion {
  const filled = (row: number, column: number) => (values[cellName(row, column)] ?? "") !== "";
  let left = position.column;
  while (left > 1 && filled(position.row, left - 1)) left -= 1;
  let right = position.column;
  while (filled(position.row, right + 1)) right += 1;
  const rowHasData = (row: number) => {
    for (let column = left; column <= right; column += 1) {
      if (filled(row, column)) return true;
    }
    return false;
  };
  let top = position.row;
  while (top > 1 && rowHasData(top - 1)) top -= 1;
  let bottom = position.row;
  while (rowHasData(bottom + 1)) bottom += 1;
  return { top, left, bottom, right };
}

/**
 * Client-side helpers of the "Data" menu features (REQ-5-1-2, REQ-5-2-1).
 *
 * The server stays the authority: it validates a filter, derives the hidden
 * rows and enforces the validation rules. These helpers only cover what the
 * dialogs need before a request is sent — the condition names shared with the
 * server, the distinct source values of one column, the data region a filter is
 * created for, and the rule the dialog submits.
 */

import { cellAddress, columnLabel, parseCellAddress } from "./coordinates";
import { selectionBounds, type CellSelection } from "./selection";
import type { FilterColumn, ValidationRule, WorksheetData, WorksheetFilter } from "./types";

export const FILTER_VALUES = "values";
export const FILTER_CONDITION = "condition";

export const TEXT_CONTAINS = "text-contains";
export const GREATER_THAN = "greater-than";
export const BEFORE = "before";
export const IS_EMPTY = "is-empty";
export const IS_NOT_EMPTY = "is-not-empty";

export interface FilterOperator {
  id: string;
  label: string;
  needsValue: boolean;
}

/** Options of the "Condition" combo box, in the order they are offered. */
export const FILTER_OPERATORS: readonly FilterOperator[] = [
  { id: TEXT_CONTAINS, label: "Text contains", needsValue: true },
  { id: GREATER_THAN, label: "Greater than", needsValue: true },
  { id: BEFORE, label: "Before", needsValue: true },
  { id: IS_EMPTY, label: "Is empty", needsValue: false },
  { id: IS_NOT_EMPTY, label: "Is not empty", needsValue: false },
];

export function operatorById(id: string): FilterOperator {
  return FILTER_OPERATORS.find((operator) => operator.id === id) ?? FILTER_OPERATORS[0];
}

/** Accessible name of one header's filter button and of the dialog it opens. */
export function filterButtonLabel(headerText: string): string {
  return `Filter ${headerText}`;
}

/** Grid rows the payload marks as hidden, as a lookup set. */
export function hiddenRowSet(worksheet: Pick<WorksheetData, "hiddenRows">): ReadonlySet<number> {
  return new Set(Array.isArray(worksheet.hiddenRows) ? worksheet.hiddenRows : []);
}

/** Displayed text of one cell, preferring the derived values over the raw text. */
export function displayValue(
  worksheet: Pick<WorksheetData, "cells" | "values">,
  address: string,
): string {
  return worksheet.values?.[address] ?? worksheet.cells[address] ?? "";
}

export interface FilterRegion {
  start: string;
  end: string;
}

/** Bounding box of the non-empty cells of a worksheet, or null when it is empty. */
export function usedRange(cells: Readonly<Record<string, string>>): FilterRegion | null {
  let topRow = 0;
  let bottomRow = 0;
  let leftColumn = 0;
  let rightColumn = 0;
  for (const [address, raw] of Object.entries(cells)) {
    if (typeof raw !== "string" || raw === "") continue;
    const coordinate = parseCellAddress(address);
    if (!coordinate) continue;
    topRow = topRow === 0 ? coordinate.row : Math.min(topRow, coordinate.row);
    bottomRow = Math.max(bottomRow, coordinate.row);
    leftColumn = leftColumn === 0 ? coordinate.column : Math.min(leftColumn, coordinate.column);
    rightColumn = Math.max(rightColumn, coordinate.column);
  }
  if (topRow === 0 || leftColumn === 0) return null;
  return {
    start: cellAddress(leftColumn, topRow),
    end: cellAddress(rightColumn, bottomRow),
  };
}

/** Number of rows a region spans. */
export function regionRowCount(region: FilterRegion): number {
  const start = parseCellAddress(region.start);
  const end = parseCellAddress(region.end);
  if (!start || !end) return 0;
  return Math.abs(end.row - start.row) + 1;
}

/** Column letters of a region, left to right. */
export function regionColumns(region: FilterRegion): string[] {
  const start = parseCellAddress(region.start);
  const end = parseCellAddress(region.end);
  if (!start || !end) return [];
  const left = Math.min(start.column, end.column);
  const right = Math.max(start.column, end.column);
  const columns: string[] = [];
  for (let column = left; column <= right; column += 1) columns.push(columnLabel(column));
  return columns;
}

/** First row of a region, i.e. the line that carries the headers. */
export function regionHeaderRow(region: FilterRegion): number {
  const start = parseCellAddress(region.start);
  const end = parseCellAddress(region.end);
  if (!start || !end) return 0;
  return Math.min(start.row, end.row);
}

/** Rows of a region after its header line, top to bottom. */
export function regionDataRows(region: FilterRegion): number[] {
  const start = parseCellAddress(region.start);
  const end = parseCellAddress(region.end);
  if (!start || !end) return [];
  const first = Math.min(start.row, end.row) + 1;
  const last = Math.max(start.row, end.row);
  const rows: number[] = [];
  for (let row = first; row <= last; row += 1) rows.push(row);
  return rows;
}

/** Header text of one column of a region, i.e. the value of its first row. */
export function headerTextFor(
  worksheet: Pick<WorksheetData, "cells" | "values">,
  region: FilterRegion,
  column: string,
): string {
  const headerRow = regionHeaderRow(region);
  return headerRow === 0 ? "" : displayValue(worksheet, `${column}${headerRow}`);
}

/**
 * Distinct displayed values of one column inside the data rows of a region, in
 * the order they first appear. Blank cells have no value to offer, so they are
 * not listed.
 */
export function distinctValues(
  worksheet: Pick<WorksheetData, "cells" | "values">,
  region: FilterRegion,
  column: string,
): string[] {
  const values: string[] = [];
  for (const row of regionDataRows(region)) {
    const value = displayValue(worksheet, `${column}${row}`);
    if (value.trim() === "" || values.includes(value)) continue;
    values.push(value);
  }
  return values;
}

/** The column entry of an existing filter, when that column is already filtered. */
export function filterColumnEntry(
  filter: WorksheetFilter | null | undefined,
  column: string,
): FilterColumn | null {
  return filter?.columns?.[column] ?? null;
}

/**
 * Region "Create filter" applies to: the selected rectangle when it covers more
 * than one cell, otherwise the data region around the current cell. Returns
 * null when there is no region with a header row and at least one data row.
 */
export function filterRegionFor(
  selection: CellSelection,
  cells: Readonly<Record<string, string>>,
): FilterRegion | null {
  const bounds = selectionBounds(selection);
  const selected =
    (bounds.bottomRow - bounds.topRow + 1) * (bounds.rightColumn - bounds.leftColumn + 1) > 1
      ? {
        start: cellAddress(bounds.leftColumn, bounds.topRow),
        end: cellAddress(bounds.rightColumn, bounds.bottomRow),
      }
      : null;
  const region = selected ?? usedRange(cells);
  if (!region) return null;
  return regionRowCount(region) >= 2 ? region : null;
}

/** Filter with one column entry replaced (`null` removes that column's entry). */
export function withColumnEntry(
  filter: WorksheetFilter,
  column: string,
  entry: FilterColumn | null,
): WorksheetFilter {
  const columns: Record<string, FilterColumn> = { ...(filter.columns ?? {}) };
  if (entry) columns[column] = entry;
  else delete columns[column];
  return { range: { ...filter.range }, columns };
}

/** Rule the "Data validation" dialog saves, with the prompt it displays. */
export function dropdownRuleValues(text: string): string[] {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

export function dropdownRuleMessage(values: readonly string[]): string {
  return `Please select one of the following values: ${values.join(", ")}`;
}

export function numberRangeRuleMessage(min: number, max: number): string {
  return `Please enter a number between ${min} and ${max}`;
}

/** True when a rule covers a coordinate, so the grid can show its entry point. */
export function ruleCoversAddress(rule: ValidationRule, address: string): boolean {
  const coordinate = parseCellAddress(address);
  const start = parseCellAddress(rule.range?.start ?? "");
  const end = parseCellAddress(rule.range?.end ?? "");
  if (!coordinate || !start || !end) return false;
  return (
    coordinate.column >= Math.min(start.column, end.column)
    && coordinate.column <= Math.max(start.column, end.column)
    && coordinate.row >= Math.min(start.row, end.row)
    && coordinate.row <= Math.max(start.row, end.row)
  );
}

/** First dropdown rule covering a coordinate, i.e. the cell's dropdown entry point. */
export function dropdownRuleFor(
  worksheet: Pick<WorksheetData, "validations">,
  address: string,
): ValidationRule | null {
  const rules = Array.isArray(worksheet.validations) ? worksheet.validations : [];
  return rules.find((rule) => rule.type === "dropdown" && ruleCoversAddress(rule, address)) ?? null;
}

/** First rule covering the top-left corner of a region, i.e. the rule to reopen. */
export function ruleForRegion(
  worksheet: Pick<WorksheetData, "validations">,
  region: FilterRegion,
): ValidationRule | null {
  const rules = Array.isArray(worksheet.validations) ? worksheet.validations : [];
  return rules.find((rule) => ruleCoversAddress(rule, region.start)) ?? null;
}

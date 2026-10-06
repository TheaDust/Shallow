/**
 * Test-double mirror of the backend pivot and area domain: derived summary
 * cell maps plus the A1 area helpers that follow a row/column change.
 */

import { cellName, parseCellName } from "../domain/grid";
import type { FilterView, SummarizeMethod } from "../domain/types";

function parseCellNumber(text: unknown): number | null {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function formatCellNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

export interface Bounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function areaBounds(value: unknown): Bounds | null {
  const text = typeof value === "string" ? value.trim() : "";
  const parts = text.split(":");
  if (parts.length < 1 || parts.length > 2) return null;
  const first = parseCellName(parts[0]);
  const last = parts.length === 2 ? parseCellName(parts[1]) : first;
  if (!first || !last) return null;
  return {
    top: Math.min(first.row, last.row),
    bottom: Math.max(first.row, last.row),
    left: Math.min(first.column, last.column),
    right: Math.max(first.column, last.column),
  };
}

export function boundsText(bounds: Bounds): string {
  const start = cellName(bounds.top, bounds.left);
  const end = cellName(bounds.bottom, bounds.right);
  return start === end ? start : `${start}:${end}`;
}

/** Moves an A1 area with its cells; `null` when a deleted line covered it. */
export function shiftArea(area: unknown, axis: "row" | "column", mode: string, at: number): string | null {
  const bounds = areaBounds(area);
  if (!bounds) return null;
  const next = { ...bounds };
  if (axis === "row") {
    if (mode === "delete") {
      next.top = next.top > at ? next.top - 1 : next.top;
      next.bottom = next.bottom >= at ? next.bottom - 1 : next.bottom;
    } else {
      next.top = next.top >= at ? next.top + 1 : next.top;
      next.bottom = next.bottom >= at ? next.bottom + 1 : next.bottom;
    }
  } else if (mode === "delete") {
    next.left = next.left > at ? next.left - 1 : next.left;
    next.right = next.right >= at ? next.right - 1 : next.right;
  } else {
    next.left = next.left >= at ? next.left + 1 : next.left;
    next.right = next.right >= at ? next.right + 1 : next.right;
  }
  if (next.bottom < next.top || next.right < next.left) return null;
  return boundsText(next);
}

/** Moves one filter view's column indexes with an inserted or deleted column. */
export function shiftColumnsOf(
  columns: FilterView["filter"]["columns"],
  mode: string,
  at: number,
): FilterView["filter"]["columns"] {
  return columns.flatMap((column) => {
    if (mode === "delete" && column.column === at) return [];
    if (mode === "delete" ? column.column > at : column.column >= at) {
      return [{ ...column, column: column.column + (mode === "delete" ? -1 : 1) }];
    }
    return [column];
  });
}

/** Mirror of the backend pivot builder; returns the message instead of throwing. */
export function buildPivotCells(
  cells: Record<string, string>,
  range: string,
  config: { rowField: string; columnField: string; valueField: string; summarizeBy: SummarizeMethod },
): { cells: Record<string, string> } | { error: string } {
  const bounds = areaBounds(range);
  if (!bounds) return { error: "Invalid pivot table configuration" };
  const headers: Array<{ column: number; header: string }> = [];
  for (let column = bounds.left; column <= bounds.right; column += 1) {
    const header = cells[cellName(bounds.top, column)] ?? "";
    if (header !== "") headers.push({ column, header });
  }
  const columnOf = (field: string) => headers.find((header) => header.header === field)?.column ?? null;
  const rowColumn = columnOf(config.rowField);
  const valueColumn = columnOf(config.valueField);
  const columnColumn = config.columnField === "" ? null : columnOf(config.columnField);
  if (rowColumn === null || valueColumn === null || (config.columnField !== "" && columnColumn === null)) {
    return { error: "Pivot field is no longer available. Select a new field." };
  }
  const records: Array<{ row: string; column: string | null; value: string }> = [];
  for (let row = bounds.top + 1; row <= bounds.bottom; row += 1) {
    const group = cells[cellName(row, rowColumn)] ?? "";
    if (group === "") continue;
    records.push({
      row: group,
      column: columnColumn === null ? null : cells[cellName(row, columnColumn)] ?? "",
      value: cells[cellName(row, valueColumn)] ?? "",
    });
  }
  const summarize = (values: string[]) => {
    if (config.summarizeBy === "COUNT") return values.filter((value) => value !== "").length;
    const numbers = values.map(parseCellNumber).filter((value): value is number => value !== null);
    if (config.summarizeBy === "AVERAGE") {
      return numbers.length === 0 ? 0 : numbers.reduce((total, value) => total + value, 0) / numbers.length;
    }
    return numbers.reduce((total, value) => total + value, 0);
  };
  if (config.summarizeBy !== "COUNT" && !records.some((record) => parseCellNumber(record.value) !== null)) {
    return { error: "Value field requires numeric values" };
  }
  const firstAppearance = (values: string[]) => [...new Set(values)];
  const rowGroups = firstAppearance(records.map((record) => record.row));
  const result: Record<string, string> = { A1: config.rowField };
  if (columnColumn === null) {
    result.B1 = `${config.summarizeBy} of ${config.valueField}`;
    rowGroups.forEach((group, index) => {
      result[cellName(index + 2, 1)] = group;
      result[cellName(index + 2, 2)] = formatCellNumber(
        summarize(records.filter((record) => record.row === group).map((record) => record.value)),
      );
    });
    result[cellName(rowGroups.length + 2, 1)] = "Grand Total";
    result[cellName(rowGroups.length + 2, 2)] = formatCellNumber(summarize(records.map((record) => record.value)));
    return { cells: result };
  }
  const columnGroups = firstAppearance(records.map((record) => record.column ?? ""));
  columnGroups.forEach((group, index) => {
    result[cellName(1, index + 2)] = group;
  });
  const totalColumn = columnGroups.length + 2;
  result[cellName(1, totalColumn)] = "Grand Total";
  rowGroups.forEach((group, index) => {
    const line = index + 2;
    const rowRecords = records.filter((record) => record.row === group);
    result[cellName(line, 1)] = group;
    columnGroups.forEach((group2, columnIndex) => {
      result[cellName(line, columnIndex + 2)] = formatCellNumber(
        summarize(rowRecords.filter((record) => record.column === group2).map((record) => record.value)),
      );
    });
    result[cellName(line, totalColumn)] = formatCellNumber(summarize(rowRecords.map((record) => record.value)));
  });
  const totalLine = rowGroups.length + 2;
  result[cellName(totalLine, 1)] = "Grand Total";
  columnGroups.forEach((group, columnIndex) => {
    result[cellName(totalLine, columnIndex + 2)] = formatCellNumber(
      summarize(records.filter((record) => record.column === group).map((record) => record.value)),
    );
  });
  result[cellName(totalLine, totalColumn)] = formatCellNumber(summarize(records.map((record) => record.value)));
  return { cells: result };
}

/** Mirror of the backend default layout: first header groups, first numeric header sums. */
export function defaultPivotConfig(
  cells: Record<string, string>,
  range: string,
): { rowField: string; columnField: string; valueField: string; summarizeBy: SummarizeMethod } | null {
  const bounds = areaBounds(range);
  if (!bounds) return null;
  const headers: Array<{ column: number; header: string }> = [];
  for (let column = bounds.left; column <= bounds.right; column += 1) {
    const header = cells[cellName(bounds.top, column)] ?? "";
    if (header !== "") headers.push({ column, header });
  }
  if (headers.length === 0) return null;
  const rowField = headers[0].header;
  const numeric = headers.find((header) => {
    for (let row = bounds.top + 1; row <= bounds.bottom; row += 1) {
      if (parseCellNumber(cells[cellName(row, header.column)]) !== null) return true;
    }
    return false;
  });
  if (numeric) return { rowField, columnField: "", valueField: numeric.header, summarizeBy: "SUM" };
  const counted = headers.find((header) => header.header !== rowField) ?? headers[0];
  return { rowField, columnField: "", valueField: counted.header, summarizeBy: "COUNT" };
}

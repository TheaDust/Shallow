import type { CellRegion } from "../lib/cells";
import type { PivotData, WorksheetData } from "../workbooks/types";
import {
  MISSING_PIVOT_FIELD_MESSAGE,
  MISSING_PIVOT_SELECTION_MESSAGE,
  MISSING_PIVOT_SOURCE_MESSAGE,
  NUMERIC_VALUE_FIELD_MESSAGE,
} from "../editor/pivot";

/**
 * Pivot summarization of the fake server, mirroring `backend/src/lib/pivot.mjs`: the same layout,
 * the same field resolution by source header text and the same refusal messages, so the frontend
 * tests exercise the flow the real server serves.
 */

const GRAND_TOTAL_LABEL = "Grand Total";
const BLANK_GROUP_LABEL = "(blank)";

export interface PivotComputation {
  cells: Record<string, { value: string }>;
  rowCount: number;
  columnCount: number;
}

function columnLabel(column: number): string {
  let label = "";
  for (let rest = column; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    label = String.fromCharCode(65 + ((rest - 1) % 26)) + label;
  }
  return label;
}

function cellId(row: number, column: number): string {
  return `${columnLabel(column)}${row}`;
}

function displayedText(worksheet: WorksheetData, row: number, column: number): string {
  const cell = worksheet.cells[cellId(row, column)];
  if (!cell) return "";
  return cell.display ?? cell.value ?? "";
}

function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value * 1e10) / 1e10);
}

function groupLabel(text: string): string {
  return text.trim() === "" ? BLANK_GROUP_LABEL : text;
}

/** Header texts of a source range, used as the option names of the editor. */
export function fakeSourceHeaders(source: WorksheetData, range: CellRegion): string[] {
  const headers: string[] = [];
  for (let column = range.left; column <= range.right; column += 1) {
    const text = displayedText(source, range.top, column);
    if (text.trim() !== "") headers.push(text);
  }
  return headers;
}

export function computeFakePivot(
  source: WorksheetData,
  pivot: PivotData,
): PivotComputation | { error: string } {
  const range = pivot.sourceRange;
  if (
    !source ||
    !range ||
    range.bottom <= range.top ||
    range.bottom > source.rowCount ||
    range.right > source.columnCount
  ) {
    return { error: MISSING_PIVOT_SOURCE_MESSAGE };
  }
  const rows = pivot.rows ?? "";
  const values = pivot.values ?? "";
  const columns = pivot.columns ?? "";
  if (rows === "" || values === "") return { error: MISSING_PIVOT_SELECTION_MESSAGE };

  const columnOfField = (name: string): number => {
    for (let column = range.left; column <= range.right; column += 1) {
      if (displayedText(source, range.top, column).trim() === name) return column;
    }
    return -1;
  };
  const rowColumn = columnOfField(rows);
  const valueColumn = columnOfField(values);
  const columnColumn = columns === "" ? -1 : columnOfField(columns);
  if (rowColumn < 0 || valueColumn < 0 || (columns !== "" && columnColumn < 0)) {
    return { error: MISSING_PIVOT_FIELD_MESSAGE };
  }

  const records: { row: string; column: string | null; value: string }[] = [];
  for (let row = range.top + 1; row <= range.bottom; row += 1) {
    let hasContent = false;
    for (let column = range.left; column <= range.right; column += 1) {
      if (displayedText(source, row, column) !== "") {
        hasContent = true;
        break;
      }
    }
    if (!hasContent) continue;
    records.push({
      row: groupLabel(displayedText(source, row, rowColumn)),
      column: columnColumn < 0 ? null : groupLabel(displayedText(source, row, columnColumn)),
      value: displayedText(source, row, valueColumn),
    });
  }

  const summarizeBy = pivot.summarizeBy;
  if (summarizeBy !== "COUNT" && !records.some((record) => parseNumber(record.value) !== null)) {
    return { error: NUMERIC_VALUE_FIELD_MESSAGE };
  }

  const aggregate = (list: typeof records): number => {
    if (summarizeBy === "COUNT") return list.filter((record) => record.value.trim() !== "").length;
    const numbers = list.flatMap((record) => {
      const parsed = parseNumber(record.value);
      return parsed === null ? [] : [parsed];
    });
    if (numbers.length === 0) return 0;
    const total = numbers.reduce((sum, value) => sum + value, 0);
    return summarizeBy === "AVERAGE" ? total / numbers.length : total;
  };

  const rowKeys: string[] = [];
  const columnKeys: string[] = [];
  for (const record of records) {
    if (!rowKeys.includes(record.row)) rowKeys.push(record.row);
    if (record.column !== null && !columnKeys.includes(record.column)) columnKeys.push(record.column);
  }
  const matching = (rowKey: string, columnKey: string | null) =>
    records.filter((record) => record.row === rowKey && (columnKey === null || record.column === columnKey));

  const text: Record<string, string> = {};
  text[cellId(1, 1)] = rows;
  text[cellId(1, 2)] = `${summarizeBy} of ${values}`;

  if (columnColumn < 0) {
    rowKeys.forEach((key, index) => {
      text[cellId(index + 2, 1)] = key;
      text[cellId(index + 2, 2)] = formatNumber(aggregate(matching(key, null)));
    });
    const totalRow = rowKeys.length + 2;
    text[cellId(totalRow, 1)] = GRAND_TOTAL_LABEL;
    text[cellId(totalRow, 2)] = formatNumber(aggregate(records));
    return {
      cells: toCells(text),
      rowCount: Math.max(source.rowCount, totalRow),
      columnCount: Math.max(source.columnCount, 2),
    };
  }

  columnKeys.forEach((key, index) => {
    text[cellId(1, index + 2)] = key;
  });
  const totalColumn = columnKeys.length + 2;
  text[cellId(1, totalColumn)] = GRAND_TOTAL_LABEL;
  rowKeys.forEach((key, index) => {
    const rowIndex = index + 2;
    text[cellId(rowIndex, 1)] = key;
    columnKeys.forEach((columnKey, columnIndex) => {
      text[cellId(rowIndex, columnIndex + 2)] = formatNumber(aggregate(matching(key, columnKey)));
    });
    text[cellId(rowIndex, totalColumn)] = formatNumber(aggregate(matching(key, null)));
  });
  const totalRow = rowKeys.length + 2;
  text[cellId(totalRow, 1)] = GRAND_TOTAL_LABEL;
  columnKeys.forEach((columnKey, columnIndex) => {
    text[cellId(totalRow, columnIndex + 2)] = formatNumber(
      aggregate(records.filter((record) => record.column === columnKey)),
    );
  });
  text[cellId(totalRow, totalColumn)] = formatNumber(aggregate(records));
  return {
    cells: toCells(text),
    rowCount: Math.max(source.rowCount, totalRow),
    columnCount: Math.max(source.columnCount, totalColumn),
  };
}

function toCells(text: Record<string, string>): Record<string, { value: string }> {
  const cells: Record<string, { value: string }> = {};
  for (const [id, value] of Object.entries(text)) {
    if (value === "") continue;
    cells[id] = { value };
  }
  return cells;
}

interface StructureShift {
  axis: "row" | "column";
  op: "insert" | "delete";
  index: number;
  side: "before" | "after";
}

/** Mirrors the server: a pivot source range follows the rows/columns its source worksheet moves. */
export function shiftFakePivotSources(
  workbook: { worksheets: WorksheetData[] },
  changedWorksheetId: string,
  change: StructureShift,
): void {
  const isRow = change.axis === "row";
  const move = (value: number, end: boolean): number => {
    if (change.op === "insert") {
      const boundary = change.side === "after" ? change.index + 1 : change.index;
      return value >= boundary ? value + 1 : value;
    }
    if (end ? value >= change.index : value > change.index) return value - 1;
    return value;
  };
  for (const worksheet of workbook.worksheets) {
    const pivot = worksheet.pivot;
    if (!pivot || pivot.sourceWorksheetId !== changedWorksheetId) continue;
    const range = pivot.sourceRange;
    const start = isRow ? move(range.top, false) : move(range.left, false);
    const end = Math.max(start, isRow ? move(range.bottom, true) : move(range.right, true));
    worksheet.pivot = {
      ...pivot,
      sourceRange: isRow
        ? { top: start, bottom: end, left: range.left, right: range.right }
        : { top: range.top, bottom: range.bottom, left: start, right: end },
    };
  }
}

/**
 * Basic pivot summarization (REQ-5-3). One pivot table belongs to its own worksheet: it stores
 * the source worksheet and the source range it was created from, the chosen fields and the
 * summarization method, plus the summary it last computed. The summary is written as ordinary
 * cell text, so the source worksheet is only ever read (`computePivotCells` never mutates its
 * cells) and the displayed result stays exactly what the last Apply/`Refresh pivot table`
 * produced — a source edit or a row/column change does not touch it until the next refresh.
 *
 * The source range's first row is the header row: the pivot fields are identified by the header
 * text the editor shows, which is why a deleted header turns into
 * `Pivot field is no longer available. Select a new field.` instead of a silently wrong summary.
 */

import { randomUUID } from "node:crypto";

import { cellAddress } from "./address.mjs";
import { filterBounds } from "./filter.mjs";
import { computeSheetValues, formatNumber } from "./formula.mjs";
import { shiftRangeForStructure } from "./structure.mjs";

export const PIVOT_FIELD_MISSING_MESSAGE = "Pivot field is no longer available. Select a new field.";
export const PIVOT_NUMERIC_MESSAGE = "Value field requires numeric values";
export const PIVOT_RANGE_INVALID_MESSAGE = "Invalid pivot source range";
export const PIVOT_CONFIG_INVALID_MESSAGE = "Invalid pivot configuration";

export const PIVOT_METHODS = ["SUM", "COUNT", "AVERAGE"];
export const DEFAULT_PIVOT_METHOD = "SUM";
export const GRAND_TOTAL_LABEL = "Grand Total";

/** First unused `PivotN` name in positive-integer order within the workbook. */
export function nextPivotWorksheetName(sheets) {
  const used = new Set(sheets.map((sheet) => String(sheet?.name ?? "").trim()));
  let index = 1;
  while (used.has(`Pivot${index}`)) index += 1;
  return `Pivot${index}`;
}

/** A pivot-result worksheet: blank cells plus the pending configuration of its summary. */
export function createPivotWorksheet({ sheets, sourceSheetId, sourceRange }) {
  return {
    id: randomUUID(),
    name: nextPivotWorksheetName(sheets),
    cells: {},
    pivot: {
      sourceSheetId,
      sourceRange,
      rowField: "",
      columnField: "",
      valueField: "",
      method: DEFAULT_PIVOT_METHOD,
    },
  };
}

/** Canonical `A1:C4` text of a submitted source range, or null when it is unusable. */
export function normalizePivotRange(raw) {
  const text = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  const bounds = filterBounds(text);
  if (!bounds) return null;
  const start = cellAddress(bounds.top - 1, bounds.left - 1);
  const end = cellAddress(bounds.bottom - 1, bounds.right - 1);
  return start === end ? start : `${start}:${end}`;
}

/** Normalized field selection of an Apply/refresh request, or null when it is unusable. */
export function normalizePivotConfig(payload) {
  if (!payload || typeof payload !== "object") return null;
  const method = typeof payload.method === "string" ? payload.method.toUpperCase() : "";
  if (!PIVOT_METHODS.includes(method)) return null;
  return {
    rowField: typeof payload.rowField === "string" ? payload.rowField.trim() : "",
    columnField: typeof payload.columnField === "string" ? payload.columnField.trim() : "",
    valueField: typeof payload.valueField === "string" ? payload.valueField.trim() : "",
    method,
  };
}

/** A parseable number, or null for an empty or nonnumeric value field entry. */
function parseNumber(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * Summary cells of one pivot configuration read from `sourceSheet`.
 * @returns {{ ok: true, cells: Record<string, string> } | { ok: false, error: string }}
 */
export function computePivotCells({ sourceSheet, config }) {
  const bounds = filterBounds(config?.sourceRange);
  if (!sourceSheet || !bounds) return { ok: false, error: PIVOT_RANGE_INVALID_MESSAGE };

  const values = computeSheetValues(sourceSheet.cells, {
    rows: sourceSheet.rowCount,
    columns: sourceSheet.columnCount,
  });
  // 1-based reader of a displayed value; the grid defaults live in `filterBounds`.
  const text = (row, column) => values[cellAddress(row - 1, column - 1)] ?? "";

  /** 1-based column of a header text, or -1 when the header is gone. */
  function columnOfField(field) {
    if (!field) return -1;
    for (let column = bounds.left; column <= bounds.right; column += 1) {
      if (text(bounds.top, column).trim() === field) return column;
    }
    return -1;
  }

  const rowColumn = columnOfField(config.rowField);
  const valueColumn = columnOfField(config.valueField);
  const columnColumn = config.columnField ? columnOfField(config.columnField) : -1;
  if (rowColumn < 0 || valueColumn < 0 || (config.columnField && columnColumn < 0)) {
    return { ok: false, error: PIVOT_FIELD_MISSING_MESSAGE };
  }

  const records = [];
  for (let row = bounds.top + 1; row <= bounds.bottom; row += 1) {
    const rowName = text(row, rowColumn).trim();
    const valueText = text(row, valueColumn).trim();
    const columnName = columnColumn > 0 ? text(row, columnColumn).trim() : "";
    if (rowName === "" && valueText === "" && columnName === "") continue;
    records.push({ rowName, valueText, columnName });
  }

  // COUNT never fails on nonnumeric content; the numeric methods need at least one number.
  if (config.method !== "COUNT" && !records.some((record) => parseNumber(record.valueText) !== null)) {
    return { ok: false, error: PIVOT_NUMERIC_MESSAGE };
  }

  const aggregate = (entries) => {
    if (config.method === "COUNT") return String(entries.filter((entry) => entry !== "").length);
    const numbers = entries.map(parseNumber).filter((entry) => entry !== null);
    const total = numbers.reduce((sum, entry) => sum + entry, 0);
    if (config.method === "AVERAGE") return formatNumber(numbers.length ? total / numbers.length : 0);
    return formatNumber(total);
  };

  // Groups appear in the order of the first source record that carries them.
  const rowNames = [];
  const columnNames = [];
  for (const record of records) {
    if (!rowNames.includes(record.rowName)) rowNames.push(record.rowName);
    if (columnColumn > 0 && !columnNames.includes(record.columnName)) {
      columnNames.push(record.columnName);
    }
  }

  const valuesOf = (entries) => entries.map((entry) => entry.valueText);
  const cells = {};
  cells.A1 = config.rowField;

  if (columnColumn < 0) {
    cells.B1 = `${config.method} of ${config.valueField}`;
    rowNames.forEach((name, index) => {
      const row = index + 2;
      cells[`A${row}`] = name;
      cells[`B${row}`] = aggregate(
        valuesOf(records.filter((record) => record.rowName === name)),
      );
    });
    const totalRow = rowNames.length + 2;
    cells[`A${totalRow}`] = GRAND_TOTAL_LABEL;
    cells[`B${totalRow}`] = aggregate(valuesOf(records));
    return { ok: true, cells };
  }

  columnNames.forEach((name, index) => {
    cells[cellAddress(0, index + 1)] = name;
  });
  const totalColumn = columnNames.length + 1;
  cells[cellAddress(0, totalColumn)] = GRAND_TOTAL_LABEL;

  rowNames.forEach((name, index) => {
    const row = index + 1;
    const inRow = records.filter((record) => record.rowName === name);
    cells[cellAddress(row, 0)] = name;
    columnNames.forEach((columnName, columnIndex) => {
      cells[cellAddress(row, columnIndex + 1)] = aggregate(
        valuesOf(inRow.filter((record) => record.columnName === columnName)),
      );
    });
    cells[cellAddress(row, totalColumn)] = aggregate(valuesOf(inRow));
  });

  const totalRow = rowNames.length + 1;
  cells[cellAddress(totalRow, 0)] = GRAND_TOTAL_LABEL;
  columnNames.forEach((columnName, columnIndex) => {
    cells[cellAddress(totalRow, columnIndex + 1)] = aggregate(
      valuesOf(records.filter((record) => record.columnName === columnName)),
    );
  });
  cells[cellAddress(totalRow, totalColumn)] = aggregate(valuesOf(records));
  return { ok: true, cells };
}

/**
 * The source range of a pivot after a row/column structure change of its source worksheet: the
 * stored range follows the band the way a reference does, so a later refresh reads the adjusted
 * region. A change that removes the whole range leaves the last range in place (the refresh then
 * reports the invalid source instead of silently reading a different region).
 */
export function shiftPivotSourceRange(range, change) {
  return shiftRangeForStructure(range, change) ?? range;
}

import { cellCoordinate, parseCellCoordinate } from "./spreadsheet.mjs";

/**
 * Basic pivot summarization (REQ-5-3-1). The module is pure: it reads a source range of a
 * worksheet's cell map and returns the cell map of the pivot result, so a caller can decide when
 * to write it. Nothing here touches the source cells.
 *
 * Result layout:
 *
 * - without a column field: `A1` is the row-field name, `B1` is `<method> of <value field>`, one
 *   row per group in order of first appearance and a final `Grand Total` row;
 * - with a column field: `A1` is the row-field name, the column-field values follow from `B1` in
 *   order of first appearance and the final column is `Grand Total`, with the row groups and the
 *   final `Grand Total` row arranged the same way.
 */

export const SUMMARIZE_METHODS = ["SUM", "COUNT", "AVERAGE"];

export const PIVOT_FIELDS_REQUIRED_MESSAGE = "Select a row field and a value field";
export const PIVOT_FIELD_UNAVAILABLE_MESSAGE = "Pivot field is no longer available. Select a new field.";
export const PIVOT_NUMERIC_MESSAGE = "Value field requires numeric values";
export const PIVOT_RANGE_MESSAGE = "Invalid pivot source range";

export const GRAND_TOTAL_LABEL = "Grand Total";

/** A refused pivot request; `workbooks.mjs` turns it into the HTTP-level `DomainError`. */
export class PivotError extends Error {
  constructor(message) {
    super(message);
    this.name = "PivotError";
  }
}

/** First unused `PivotN` name in positive-integer order (`Pivot1`+`Pivot2` → `Pivot3`). */
export function nextPivotWorksheetName(worksheets) {
  const used = new Set();
  for (const worksheet of worksheets ?? []) {
    const match = /^Pivot([1-9][0-9]*)$/.exec(worksheet?.name ?? "");
    if (match) used.add(Number(match[1]));
  }
  let index = 1;
  while (used.has(index)) index += 1;
  return `Pivot${index}`;
}

/** Header of the value column: `<summarization method> of <value field>`. */
export function summaryHeader(method, valueField) {
  return `${method} of ${valueField}`;
}

function bounds(range) {
  const start = parseCellCoordinate(range?.start);
  const end = parseCellCoordinate(range?.end);
  if (!start || !end) return null;
  return {
    minRow: Math.min(start.row, end.row),
    maxRow: Math.max(start.row, end.row),
    minColumn: Math.min(start.column, end.column),
    maxColumn: Math.max(start.column, end.column),
  };
}

function cellText(cells, row, column) {
  const value = cells?.[cellCoordinate(row, column)];
  return value === null || value === undefined ? "" : String(value);
}

/** Header texts of the first row of the source range, in column order (empty headers dropped). */
export function sourceFields(cells, range) {
  const area = bounds(range);
  if (!area) return [];
  const fields = [];
  for (let column = area.minColumn; column <= area.maxColumn; column += 1) {
    const text = cellText(cells, area.minRow, column).trim();
    if (text !== "") fields.push(text);
  }
  return fields;
}

function columnOfField(cells, area, field) {
  for (let column = area.minColumn; column <= area.maxColumn; column += 1) {
    if (cellText(cells, area.minRow, column).trim() === field) return column;
  }
  return -1;
}

function parseNumber(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Aggregated value as text: an integer count, or a number without floating-point noise. */
function formatNumber(value) {
  if (!Number.isFinite(value)) return "0";
  return String(Number(value.toFixed(10)));
}

/** Data rows of the source range: every row below the header row that carries at least one value. */
function sourceRecords(cells, area) {
  const records = [];
  for (let row = area.minRow + 1; row <= area.maxRow; row += 1) {
    let empty = true;
    for (let column = area.minColumn; column <= area.maxColumn; column += 1) {
      if (cellText(cells, row, column) !== "") {
        empty = false;
        break;
      }
    }
    if (!empty) records.push(row);
  }
  return records;
}

/**
 * Default configuration of a freshly created pivot: the first header is the row field and the
 * value field is the first field (other than the row field) that holds parseable numbers, or -
 * when the source has no numbers at all - the next field with `COUNT`.
 */
export function defaultPivotSettings(cells, range) {
  const area = bounds(range);
  const fields = sourceFields(cells, range);
  if (!area || !fields.length) throw new PivotError(PIVOT_RANGE_MESSAGE);

  const rows = fields[0];
  const rest = fields.slice(1);
  const numeric = rest.find((field) => {
    const column = columnOfField(cells, area, field);
    return sourceRecords(cells, area).some((row) => parseNumber(cellText(cells, row, column)) !== null);
  });
  if (numeric) return { rows, columns: null, values: numeric, summarizeBy: "SUM" };
  const counted = rest[0] ?? fields[0];
  return { rows, columns: null, values: counted, summarizeBy: "COUNT" };
}

/** Normalizes an incoming pivot configuration; unusable field names become `null`. */
export function normalizePivotSettings(settings) {
  const field = (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
  return {
    rows: field(settings?.rows),
    columns: field(settings?.columns),
    values: field(settings?.values),
    summarizeBy: SUMMARIZE_METHODS.includes(settings?.summarizeBy) ? settings.summarizeBy : SUMMARIZE_METHODS[0],
  };
}

/**
 * Computes the result cells of one pivot configuration over a source range. Throws a `PivotError`
 * when a configured field is no longer a header of the source range, when the configuration is
 * incomplete, or when SUM/AVERAGE meets a value field without a single parseable number.
 */
export function computePivotCells(cells, range, settings) {
  const area = bounds(range);
  if (!area) throw new PivotError(PIVOT_RANGE_MESSAGE);
  const { rows: rowField, columns: columnField, values: valueField, summarizeBy } = normalizePivotSettings(settings);
  if (!rowField || !valueField) throw new PivotError(PIVOT_FIELDS_REQUIRED_MESSAGE);

  const rowColumn = columnOfField(cells, area, rowField);
  const valueColumn = columnOfField(cells, area, valueField);
  const columnColumn = columnField ? columnOfField(cells, area, columnField) : -1;
  if (rowColumn < 0 || valueColumn < 0 || (columnField !== null && columnColumn < 0)) {
    throw new PivotError(PIVOT_FIELD_UNAVAILABLE_MESSAGE);
  }

  const records = sourceRecords(cells, area).map((row) => ({
    rowKey: cellText(cells, row, rowColumn).trim(),
    columnKey: columnColumn >= 0 ? cellText(cells, row, columnColumn).trim() : null,
    value: cellText(cells, row, valueColumn),
  }));

  if (summarizeBy !== "COUNT") {
    const numeric = records.filter((record) => parseNumber(record.value) !== null).length;
    if (!numeric) throw new PivotError(PIVOT_NUMERIC_MESSAGE);
  }

  const aggregate = (selected) => {
    if (summarizeBy === "COUNT") {
      return selected.filter((record) => record.value.trim() !== "").length;
    }
    const numbers = selected.map((record) => parseNumber(record.value)).filter((value) => value !== null);
    if (!numbers.length) return 0;
    const total = numbers.reduce((sum, value) => sum + value, 0);
    return summarizeBy === "AVERAGE" ? total / numbers.length : total;
  };

  const rowKeys = [];
  const columnKeys = [];
  for (const record of records) {
    if (!rowKeys.includes(record.rowKey)) rowKeys.push(record.rowKey);
    if (columnColumn >= 0 && !columnKeys.includes(record.columnKey)) columnKeys.push(record.columnKey);
  }
  const matching = (rowKey, columnKey) => records.filter(
    (record) => (rowKey === null || record.rowKey === rowKey)
      && (columnKey === null || record.columnKey === columnKey),
  );

  const result = { A1: rowField };
  if (columnColumn < 0) {
    result.B1 = summaryHeader(summarizeBy, valueField);
    rowKeys.forEach((key, index) => {
      result[cellCoordinate(index + 1, 0)] = key;
      result[cellCoordinate(index + 1, 1)] = formatNumber(aggregate(matching(key, null)));
    });
    result[cellCoordinate(rowKeys.length + 1, 0)] = GRAND_TOTAL_LABEL;
    result[cellCoordinate(rowKeys.length + 1, 1)] = formatNumber(aggregate(records));
    return result;
  }

  const totalColumn = columnKeys.length + 1;
  columnKeys.forEach((key, index) => {
    result[cellCoordinate(0, index + 1)] = key;
  });
  result[cellCoordinate(0, totalColumn)] = GRAND_TOTAL_LABEL;
  rowKeys.forEach((key, index) => {
    const row = index + 1;
    result[cellCoordinate(row, 0)] = key;
    columnKeys.forEach((columnKey, columnIndex) => {
      result[cellCoordinate(row, columnIndex + 1)] = formatNumber(aggregate(matching(key, columnKey)));
    });
    result[cellCoordinate(row, totalColumn)] = formatNumber(aggregate(matching(key, null)));
  });
  const totalRow = rowKeys.length + 1;
  result[cellCoordinate(totalRow, 0)] = GRAND_TOTAL_LABEL;
  columnKeys.forEach((columnKey, index) => {
    result[cellCoordinate(totalRow, index + 1)] = formatNumber(aggregate(matching(null, columnKey)));
  });
  result[cellCoordinate(totalRow, totalColumn)] = formatNumber(aggregate(records));
  return result;
}

import { cellName, columnLabel } from "./cells.mjs";
import { filterBounds, rangeName } from "./filter.mjs";

/**
 * Basic pivot tables (REQ-5-3-1): one source range with headers is summarized into a
 * separate result worksheet. The source cells are only read. Field references are stored
 * as the source header text, so a column that moves keeps its field while a deleted header
 * becomes "no longer available" on the next refresh. The frontend mirrors this model in
 * `frontend/src/domain/pivot.ts`.
 */
export const PIVOT_METHODS = Object.freeze(["SUM", "COUNT", "AVERAGE"]);
export const PIVOT_GRAND_TOTAL_LABEL = "Grand Total";
export const PIVOT_RANGE_INVALID_MESSAGE = "Invalid pivot source range";
export const PIVOT_METHOD_INVALID_MESSAGE = "Invalid summarization method";
export const PIVOT_FIELDS_REQUIRED_MESSAGE = "Select a row field and a value field";
export const PIVOT_FIELD_MISSING_MESSAGE = "Pivot field is no longer available. Select a new field.";
export const PIVOT_VALUE_NUMERIC_MESSAGE = "Value field requires numeric values";
export const PIVOT_SOURCE_MISSING_MESSAGE = "Pivot source worksheet is no longer available";
export const PIVOT_WORKSHEET_INVALID_MESSAGE = "This worksheet does not contain a pivot table";

export class PivotError extends Error {
  constructor(message) {
    super(message);
    this.name = "PivotError";
  }
}

function cellText(worksheet, row, column) {
  return String(worksheet?.cells?.[cellName(row, column)]?.value ?? "");
}

/**
 * One option per column of the source range, in range order: the header text, or the
 * column letter when the header cell is blank (so an option always has a stable name).
 */
export function pivotFieldOptions(worksheet, range) {
  const bounds = filterBounds(range);
  if (!bounds) return [];
  const options = [];
  for (let column = bounds.left; column <= bounds.right; column += 1) {
    const name = cellText(worksheet, bounds.top, column).trim();
    options.push({ column, name: name !== "" ? name : columnLabel(column) });
  }
  return options;
}

/** Column of one named field within the current source range, or `null` when it is gone. */
export function pivotFieldColumn(worksheet, range, name) {
  const wanted = String(name ?? "");
  const match = pivotFieldOptions(worksheet, range).find((option) => option.name === wanted);
  return match ? match.column : null;
}

/** `""`/`null` mean "field not chosen"; anything else is trimmed header text. */
export function normalizePivotField(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? null : text;
}

export function normalizePivotMethod(value) {
  const text = typeof value === "string" ? value.trim().toUpperCase() : "";
  return PIVOT_METHODS.includes(text) ? text : null;
}

/** Trims and canonicalizes the range text; `null` when it is not an `A1:C6` rectangle. */
export function normalizePivotRange(range) {
  const bounds = filterBounds(range);
  return bounds ? rangeName(bounds) : null;
}

function parseNumber(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function formatNumber(value) {
  return String(Number(value.toFixed(10)));
}

function isBlankRecord(worksheet, bounds, row) {
  for (let column = bounds.left; column <= bounds.right; column += 1) {
    if (cellText(worksheet, row, column).trim() !== "") return false;
  }
  return true;
}

function requireFieldColumn(worksheet, range, name, emptyMessage) {
  const normalized = normalizePivotField(name);
  if (!normalized) throw new PivotError(emptyMessage);
  const column = pivotFieldColumn(worksheet, range, normalized);
  if (column === null) throw new PivotError(PIVOT_FIELD_MISSING_MESSAGE);
  return column;
}

/** SUM/AVERAGE read only parseable numbers; COUNT counts non-empty value cells. */
function aggregate(method, records) {
  if (method === "COUNT") {
    return String(records.filter((record) => record.valueText.trim() !== "").length);
  }
  const numbers = records
    .map((record) => parseNumber(record.valueText))
    .filter((value) => value !== null);
  if (numbers.length === 0) return "0";
  const total = numbers.reduce((sum, value) => sum + value, 0);
  return formatNumber(method === "AVERAGE" ? total / numbers.length : total);
}

/**
 * Computes the summary cells of one pivot configuration over the current source data.
 * Rows and columns are ordered by first appearance; the last row (and the last column when
 * a column field is selected) is `Grand Total`. Throws `PivotError` when a stored field is
 * missing or a SUM/AVERAGE value field has no parseable number, leaving the caller free to
 * keep the previous result.
 */
export function computePivotCells(sourceWorksheet, spec = {}) {
  const bounds = filterBounds(spec.sourceRange);
  if (!bounds) throw new PivotError(PIVOT_RANGE_INVALID_MESSAGE);
  const method = normalizePivotMethod(spec.summarizeBy);
  if (!method) throw new PivotError(PIVOT_METHOD_INVALID_MESSAGE);

  const rowColumn = requireFieldColumn(sourceWorksheet, spec.sourceRange, spec.rowField, PIVOT_FIELDS_REQUIRED_MESSAGE);
  const valueColumn = requireFieldColumn(sourceWorksheet, spec.sourceRange, spec.valueField, PIVOT_FIELDS_REQUIRED_MESSAGE);
  const columnColumn = normalizePivotField(spec.columnField) === null
    ? null
    : requireFieldColumn(sourceWorksheet, spec.sourceRange, spec.columnField, PIVOT_FIELDS_REQUIRED_MESSAGE);

  const records = [];
  for (let row = bounds.top + 1; row <= bounds.bottom; row += 1) {
    if (isBlankRecord(sourceWorksheet, bounds, row)) continue;
    records.push({
      rowValue: cellText(sourceWorksheet, row, rowColumn),
      columnValue: columnColumn === null ? "" : cellText(sourceWorksheet, row, columnColumn),
      valueText: cellText(sourceWorksheet, row, valueColumn),
    });
  }

  if (method !== "COUNT" && !records.some((record) => parseNumber(record.valueText) !== null)) {
    throw new PivotError(PIVOT_VALUE_NUMERIC_MESSAGE);
  }

  const rowKeys = [];
  const columnKeys = [];
  for (const record of records) {
    if (!rowKeys.includes(record.rowValue)) rowKeys.push(record.rowValue);
    if (columnColumn !== null && !columnKeys.includes(record.columnValue)) columnKeys.push(record.columnValue);
  }
  const forKeys = (rowValue, columnValue) =>
    records.filter(
      (record) =>
        (rowValue === null || record.rowValue === rowValue) &&
        (columnValue === null || record.columnValue === columnValue),
    );

  const cells = {};
  cells[cellName(0, 0)] = { value: normalizePivotField(spec.rowField) ?? "" };

  if (columnColumn === null) {
    cells[cellName(0, 1)] = { value: `${method} of ${normalizePivotField(spec.valueField) ?? ""}` };
    let row = 1;
    for (const key of rowKeys) {
      cells[cellName(row, 0)] = { value: key };
      cells[cellName(row, 1)] = { value: aggregate(method, forKeys(key, null)) };
      row += 1;
    }
    cells[cellName(row, 0)] = { value: PIVOT_GRAND_TOTAL_LABEL };
    cells[cellName(row, 1)] = { value: aggregate(method, records) };
    return cells;
  }

  columnKeys.forEach((key, index) => {
    cells[cellName(0, index + 1)] = { value: key };
  });
  const totalColumn = columnKeys.length + 1;
  cells[cellName(0, totalColumn)] = { value: PIVOT_GRAND_TOTAL_LABEL };

  let row = 1;
  for (const rowKey of rowKeys) {
    cells[cellName(row, 0)] = { value: rowKey };
    columnKeys.forEach((columnKey, index) => {
      cells[cellName(row, index + 1)] = { value: aggregate(method, forKeys(rowKey, columnKey)) };
    });
    cells[cellName(row, totalColumn)] = { value: aggregate(method, forKeys(rowKey, null)) };
    row += 1;
  }
  cells[cellName(row, 0)] = { value: PIVOT_GRAND_TOTAL_LABEL };
  columnKeys.forEach((columnKey, index) => {
    cells[cellName(row, index + 1)] = { value: aggregate(method, forKeys(null, columnKey)) };
  });
  cells[cellName(row, totalColumn)] = { value: aggregate(method, records) };
  return cells;
}

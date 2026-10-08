/**
 * Basic pivot summarization for a source range with headers.
 *
 * A pivot table reads a rectangular area of its source worksheet (top row =
 * headers) and derives a summary cell map from it: one row per distinct
 * row-field value, optionally one column per distinct column-field value, and
 * `Grand Total` closing the last row and — with a column field — the last
 * column. Row and column groups keep the order of their first appearance in the
 * source data. The source cells are never modified, so the caller stores the
 * result on a separate pivot worksheet.
 *
 * Everything here is pure: the fields are resolved against the *current*
 * headers of the range, which is why a later refresh can report a field that a
 * source edit removed. Errors are `ValidationError`s whose message is shown to
 * the user as it is.
 */

import { ValidationError } from "../lib/errors.mjs";
import { cellName, parseArea } from "./grid.mjs";

export const SUMMARIZE_METHODS = ["SUM", "COUNT", "AVERAGE"];

/** Label of the total row (and, with a column field, the total column). */
export const GRAND_TOTAL_LABEL = "Grand Total";

export const INVALID_PIVOT_MESSAGE = "Invalid pivot table configuration";
export const PIVOT_NO_HEADERS_MESSAGE = "Select a range with header cells to create a pivot table";
export const PIVOT_FIELD_MISSING_MESSAGE = "Pivot field is no longer available. Select a new field.";
export const PIVOT_NUMERIC_MESSAGE = "Value field requires numeric values";
export const PIVOT_SOURCE_MISSING_MESSAGE = "The pivot table source is no longer available";

/** First unused `PivotN` name in positive-integer order, so an empty book gets `Pivot1`. */
export function nextPivotName(worksheets) {
  const used = new Set((Array.isArray(worksheets) ? worksheets : []).map((worksheet) => worksheet?.name));
  let index = 1;
  while (used.has(`Pivot${index}`)) index += 1;
  return `Pivot${index}`;
}

/** Parseable number of a cell text, or `null` when the text is not a number. */
export function parsePivotNumber(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Shortest exact text of a computed aggregate (at most six decimals). */
export function formatPivotNumber(value) {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** `{ column, header }` of every non-empty header cell of a range's top row. */
export function headerColumns(cells, bounds) {
  const headers = [];
  for (let column = bounds.left; column <= bounds.right; column += 1) {
    const header = String(cells[cellName(bounds.top, column)] ?? "");
    if (header !== "") headers.push({ column, header });
  }
  return headers;
}

/** Canonical `A1`/`A1:B2` text of a rectangle. */
export function areaText(bounds) {
  const start = cellName(bounds.top, bounds.left);
  const end = cellName(bounds.bottom, bounds.right);
  return start === end ? start : `${start}:${end}`;
}

function columnOf(headers, field) {
  const match = headers.find((header) => header.header === field);
  return match ? match.column : null;
}

function firstAppearance(values) {
  const seen = [];
  for (const value of values) {
    if (!seen.includes(value)) seen.push(value);
  }
  return seen;
}

/** One aggregate of the value-field texts of a set of records. */
function summarize(values, method) {
  if (method === "COUNT") {
    // COUNT counts records with a non-empty value field, whatever the content.
    return values.filter((value) => String(value ?? "") !== "").length;
  }
  const numbers = values.map(parsePivotNumber).filter((value) => value !== null);
  if (method === "AVERAGE") {
    return numbers.length === 0 ? 0 : numbers.reduce((total, value) => total + value, 0) / numbers.length;
  }
  return numbers.reduce((total, value) => total + value, 0);
}

/** Validated field layout; throws `ValidationError` for an unusable payload. */
export function normalizePivotConfig({ rowField, columnField, valueField, summarizeBy } = {}) {
  if (typeof rowField !== "string" || rowField === "") throw new ValidationError(INVALID_PIVOT_MESSAGE);
  if (typeof valueField !== "string" || valueField === "") throw new ValidationError(INVALID_PIVOT_MESSAGE);
  if (!SUMMARIZE_METHODS.includes(summarizeBy)) throw new ValidationError(INVALID_PIVOT_MESSAGE);
  const column = columnField === undefined || columnField === null ? "" : columnField;
  if (typeof column !== "string") throw new ValidationError(INVALID_PIVOT_MESSAGE);
  return {
    rowField,
    columnField: column,
    valueField,
    summarizeBy,
  };
}

/** True when at least one record of `column` holds a parseable number. */
function columnHasNumber(cells, bounds, column) {
  for (let row = bounds.top + 1; row <= bounds.bottom; row += 1) {
    if (parsePivotNumber(cells[cellName(row, column)]) !== null) return true;
  }
  return false;
}

/**
 * Field layout of a freshly created pivot table: the first header groups the
 * rows and the first header holding numbers is summed. A range without any
 * numeric column counts the first other header instead, so creating a pivot
 * never fails on data that a later configuration can still analyze.
 */
export function defaultPivotConfig(cells, range) {
  const bounds = parseArea(range);
  if (!bounds) throw new ValidationError(INVALID_PIVOT_MESSAGE);
  const headers = headerColumns(cells, bounds);
  if (headers.length === 0) throw new ValidationError(PIVOT_NO_HEADERS_MESSAGE);
  const rowField = headers[0].header;
  const numeric = headers.find((header) => columnHasNumber(cells, bounds, header.column));
  if (numeric) return { rowField, columnField: "", valueField: numeric.header, summarizeBy: "SUM" };
  const counted = headers.find((header) => header.header !== rowField) ?? headers[0];
  return { rowField, columnField: "", valueField: counted.header, summarizeBy: "COUNT" };
}

/**
 * Cell map of the summary. Qualifying records are the data rows of the range
 * whose row-field cell is not empty; blank rows below the data are not records.
 * Throws a `ValidationError` when a configured field is no longer a header of
 * the range or when SUM/AVERAGE has no parseable number to aggregate.
 */
export function buildPivotCells({ cells, range, rowField, columnField, valueField, summarizeBy }) {
  const bounds = parseArea(range);
  if (!bounds) throw new ValidationError(INVALID_PIVOT_MESSAGE);
  if (!SUMMARIZE_METHODS.includes(summarizeBy)) throw new ValidationError(INVALID_PIVOT_MESSAGE);
  const headers = headerColumns(cells, bounds);
  const rowColumn = columnOf(headers, rowField);
  const valueColumn = columnOf(headers, valueField);
  const columnColumn = columnField === "" ? null : columnOf(headers, columnField);
  if (rowColumn === null || valueColumn === null || (columnField !== "" && columnColumn === null)) {
    throw new ValidationError(PIVOT_FIELD_MISSING_MESSAGE);
  }

  const records = [];
  for (let row = bounds.top + 1; row <= bounds.bottom; row += 1) {
    const group = String(cells[cellName(row, rowColumn)] ?? "");
    if (group === "") continue;
    records.push({
      row: group,
      column: columnColumn === null ? null : String(cells[cellName(row, columnColumn)] ?? ""),
      value: String(cells[cellName(row, valueColumn)] ?? ""),
    });
  }
  if (summarizeBy !== "COUNT" && !records.some((record) => parsePivotNumber(record.value) !== null)) {
    throw new ValidationError(PIVOT_NUMERIC_MESSAGE);
  }

  const rowGroups = firstAppearance(records.map((record) => record.row));
  const result = { A1: rowField };

  if (columnColumn === null) {
    result.B1 = `${summarizeBy} of ${valueField}`;
    rowGroups.forEach((group, index) => {
      const line = index + 2;
      result[cellName(line, 1)] = group;
      result[cellName(line, 2)] = formatPivotNumber(
        summarize(records.filter((record) => record.row === group).map((record) => record.value), summarizeBy),
      );
    });
    const totalLine = rowGroups.length + 2;
    result[cellName(totalLine, 1)] = GRAND_TOTAL_LABEL;
    result[cellName(totalLine, 2)] = formatPivotNumber(
      summarize(records.map((record) => record.value), summarizeBy),
    );
    return result;
  }

  const columnGroups = firstAppearance(records.map((record) => record.column));
  columnGroups.forEach((group, index) => {
    result[cellName(1, index + 2)] = group;
  });
  const totalColumn = columnGroups.length + 2;
  result[cellName(1, totalColumn)] = GRAND_TOTAL_LABEL;

  rowGroups.forEach((group, index) => {
    const line = index + 2;
    const rowRecords = records.filter((record) => record.row === group);
    result[cellName(line, 1)] = group;
    columnGroups.forEach((columnGroup, columnIndex) => {
      result[cellName(line, columnIndex + 2)] = formatPivotNumber(
        summarize(
          rowRecords.filter((record) => record.column === columnGroup).map((record) => record.value),
          summarizeBy,
        ),
      );
    });
    result[cellName(line, totalColumn)] = formatPivotNumber(
      summarize(rowRecords.map((record) => record.value), summarizeBy),
    );
  });

  const totalLine = rowGroups.length + 2;
  result[cellName(totalLine, 1)] = GRAND_TOTAL_LABEL;
  columnGroups.forEach((columnGroup, columnIndex) => {
    result[cellName(totalLine, columnIndex + 2)] = formatPivotNumber(
      summarize(
        records.filter((record) => record.column === columnGroup).map((record) => record.value),
        summarizeBy,
      ),
    );
  });
  result[cellName(totalLine, totalColumn)] = formatPivotNumber(
    summarize(records.map((record) => record.value), summarizeBy),
  );
  return result;
}

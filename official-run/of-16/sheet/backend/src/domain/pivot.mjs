/**
 * Basic pivot summarization of one source range (REQ-5-3-1).
 *
 * A pivot result is a separate worksheet that only *reads* the source range of
 * another worksheet: the computed summary is written into the pivot worksheet's
 * own `cells`, so the source values, their order and their grid are never
 * touched. The stored configuration (`worksheet.pivot`) names the source
 * worksheet, the A1 source range and the chosen fields, so a refresh recomputes
 * the summary from the current source content and a reload can render the same
 * layout again.
 *
 * Layout (no column field): `A1` = row field, `B1` = `<method> of <value field>`,
 * one row per row-field value in first-appearance order and a final
 * `Grand Total` row. With a column field the column-field values sit from `B1`
 * onward (first-appearance order, `Grand Total` last) and every row gets a
 * `Grand Total` column.
 */
import { DomainError } from "./errors.mjs";
import { toCellName } from "./grid.mjs";
import { parseRange } from "./validation.mjs";

export const SUMMARIZE_METHODS = Object.freeze(["SUM", "COUNT", "AVERAGE"]);

export const MISSING_FIELD_MESSAGE = "Pivot field is no longer available. Select a new field.";
export const NON_NUMERIC_MESSAGE = "Value field requires numeric values";
export const SOURCE_RANGE_MESSAGE = "The pivot source range is no longer available. Select a new range.";
export const SELECT_FIELDS_MESSAGE = "Select a row field and a value field.";

/** Text that is a complete number (`1200`, `-3.5`, `.5`, `1e3`), nothing else. */
const NUMBER_TEXT = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

const GRAND_TOTAL = "Grand Total";

function storedText(worksheet, row, col) {
  return String(worksheet?.cells?.[toCellName(row, col)] ?? "");
}

/**
 * Header row of a pivot source range: the non-empty header texts with their
 * column, in column order. An unparsable range yields no headers, which every
 * caller reports as an unusable source.
 */
export function pivotHeaderColumns(worksheet, sourceRange) {
  const region = parseRange(sourceRange);
  const headers = [];
  if (!region) return { region: null, headers };
  const seen = new Set();
  for (let col = region.minCol; col <= region.maxCol; col += 1) {
    const name = storedText(worksheet, region.minRow, col).trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    headers.push({ name, col });
  }
  return { region, headers };
}

/** Normalizes the fields submitted by the pivot editor; all values are text. */
export function normalizePivotFields(input = {}) {
  const summarizeBy = String(input?.summarizeBy ?? "").trim().toUpperCase();
  if (!SUMMARIZE_METHODS.includes(summarizeBy)) {
    throw new DomainError(`Unknown summarization method: ${input?.summarizeBy}`, 400);
  }
  return {
    rowField: String(input?.rowField ?? "").trim(),
    columnField: String(input?.columnField ?? "").trim(),
    valueField: String(input?.valueField ?? "").trim(),
    summarizeBy,
  };
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1e12) / 1e12;
  return String(rounded);
}

/** One aggregation bucket: the parseable numbers and the non-empty count. */
function newBucket() {
  return { numbers: [], count: 0 };
}

function addToBucket(bucket, text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "") return;
  bucket.count += 1;
  if (NUMBER_TEXT.test(trimmed)) bucket.numbers.push(Number(trimmed));
}

function aggregate(bucket, summarizeBy) {
  if (summarizeBy === "COUNT") return String(bucket.count);
  if (!bucket.numbers.length) return "0";
  const total = bucket.numbers.reduce((sum, value) => sum + value, 0);
  return formatNumber(summarizeBy === "AVERAGE" ? total / bucket.numbers.length : total);
}

/**
 * Computes the summary cells of one pivot from the current source worksheet.
 * Everything is derived before the caller writes, so a rejected configuration
 * (missing field, nonnumeric value field) leaves the previous result in place
 * and never touches the source worksheet.
 */
export function computePivotResult({ worksheet, pivot }) {
  const { region, headers } = pivotHeaderColumns(worksheet, pivot?.sourceRange);
  if (!region) throw new DomainError(SOURCE_RANGE_MESSAGE, 400);
  const columnOf = new Map(headers.map((header) => [header.name, header.col]));
  const rowField = String(pivot?.rowField ?? "").trim();
  const columnField = String(pivot?.columnField ?? "").trim();
  const valueField = String(pivot?.valueField ?? "").trim();
  const summarizeBy = String(pivot?.summarizeBy ?? "").trim().toUpperCase();
  if (!rowField || !valueField) throw new DomainError(SELECT_FIELDS_MESSAGE, 400);
  if (!SUMMARIZE_METHODS.includes(summarizeBy)) {
    throw new DomainError(`Unknown summarization method: ${pivot?.summarizeBy}`, 400);
  }
  const rowCol = columnOf.get(rowField);
  const valueCol = columnOf.get(valueField);
  if (rowCol === undefined || valueCol === undefined) throw new DomainError(MISSING_FIELD_MESSAGE, 400);
  let columnCol = null;
  if (columnField) {
    columnCol = columnOf.get(columnField);
    if (columnCol === undefined) throw new DomainError(MISSING_FIELD_MESSAGE, 400);
  }

  const rowLabels = [];
  const columnLabels = [];
  const cellsByKey = new Map();
  const rowTotals = [];
  const columnTotals = [];
  const grand = newBucket();
  let numericCount = 0;
  const bucketFor = (store, key) => {
    const existing = store instanceof Map ? store.get(key) : store[key];
    if (existing) return existing;
    const bucket = newBucket();
    if (store instanceof Map) store.set(key, bucket);
    else store[key] = bucket;
    return bucket;
  };

  for (let row = region.minRow + 1; row <= region.maxRow; row += 1) {
    const values = [];
    let empty = true;
    for (let col = region.minCol; col <= region.maxCol; col += 1) {
      const text = storedText(worksheet, row, col);
      if (text.trim() !== "") empty = false;
      values.push(text);
    }
    // A completely blank row is not a source record.
    if (empty) continue;
    const rowLabel = values[rowCol - region.minCol].trim();
    const columnLabel = columnCol === null ? "" : values[columnCol - region.minCol].trim();
    const valueText = values[valueCol - region.minCol];
    if (valueText.trim() !== "" && NUMBER_TEXT.test(valueText.trim())) numericCount += 1;
    let rowIndex = rowLabels.indexOf(rowLabel);
    if (rowIndex === -1) {
      rowLabels.push(rowLabel);
      rowIndex = rowLabels.length - 1;
    }
    let columnIndex = 0;
    if (columnCol !== null) {
      columnIndex = columnLabels.indexOf(columnLabel);
      if (columnIndex === -1) {
        columnLabels.push(columnLabel);
        columnIndex = columnLabels.length - 1;
      }
    }
    addToBucket(bucketFor(cellsByKey, `${rowIndex}|${columnIndex}`), valueText);
    addToBucket(bucketFor(rowTotals, rowIndex), valueText);
    if (columnCol !== null) addToBucket(bucketFor(columnTotals, columnIndex), valueText);
    addToBucket(grand, valueText);
  }

  if (summarizeBy !== "COUNT" && numericCount === 0) {
    throw new DomainError(NON_NUMERIC_MESSAGE, 400);
  }

  const cells = {};
  const set = (row, col, text) => {
    const value = String(text ?? "");
    if (value === "") return;
    cells[toCellName(row, col)] = value;
  };

  set(0, 0, rowField);
  if (columnCol === null) {
    set(0, 1, `${summarizeBy} of ${valueField}`);
    rowLabels.forEach((label, rowIndex) => {
      set(rowIndex + 1, 0, label);
      set(rowIndex + 1, 1, aggregate(rowTotals[rowIndex], summarizeBy));
    });
    set(rowLabels.length + 1, 0, GRAND_TOTAL);
    set(rowLabels.length + 1, 1, aggregate(grand, summarizeBy));
    return { cells, usedRows: rowLabels.length + 2, usedCols: 2 };
  }

  columnLabels.forEach((label, columnIndex) => set(0, columnIndex + 1, label));
  set(0, columnLabels.length + 1, GRAND_TOTAL);
  rowLabels.forEach((label, rowIndex) => {
    set(rowIndex + 1, 0, label);
    columnLabels.forEach((_, columnIndex) => {
      set(
        rowIndex + 1,
        columnIndex + 1,
        aggregate(bucketFor(cellsByKey, `${rowIndex}|${columnIndex}`), summarizeBy),
      );
    });
    set(rowIndex + 1, columnLabels.length + 1, aggregate(rowTotals[rowIndex], summarizeBy));
  });
  set(rowLabels.length + 1, 0, GRAND_TOTAL);
  columnLabels.forEach((_, columnIndex) => {
    set(rowLabels.length + 1, columnIndex + 1, aggregate(columnTotals[columnIndex], summarizeBy));
  });
  set(rowLabels.length + 1, columnLabels.length + 1, aggregate(grand, summarizeBy));
  return { cells, usedRows: rowLabels.length + 2, usedCols: columnLabels.length + 2 };
}

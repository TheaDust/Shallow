import { cellCoordinate } from "./workbook-model.mjs";

/** Summarization methods offered by the pivot "Summarize by" combo box. */
export const PIVOT_SUMMARIZE_METHODS = ["SUM", "COUNT", "AVERAGE"];

/** Shown when a configured source header can no longer be located. */
export const PIVOT_FIELD_MISSING = "Pivot field is no longer available. Select a new field.";

/** Shown when SUM/AVERAGE has no parseable number in the value field. */
export const PIVOT_NUMERIC_REQUIRED = "Value field requires numeric values";

function textAt(cells, row, col) {
  const value = cells[cellCoordinate(row, col)];
  return value === undefined || value === null ? "" : value;
}

/**
 * Source columns that can act as pivot fields: the columns of the range whose
 * header cell (its first row) carries a non-empty display name. Duplicate
 * header text is offered once, matching the field named by that text.
 */
export function pivotHeaderFields(worksheet, range) {
  const fields = [];
  if (!range) return fields;
  const seen = new Set();
  for (let col = range.minCol; col <= range.maxCol; col += 1) {
    const name = textAt(worksheet.cells, range.minRow, col).trim();
    if (name === "" || seen.has(name)) continue;
    seen.add(name);
    fields.push({ col, name });
  }
  return fields;
}

/** Column index of a source header by its exact text, or -1 when it moved away. */
function headerColumn(worksheet, range, name) {
  if (typeof name !== "string" || name === "") return -1;
  for (let col = range.minCol; col <= range.maxCol; col += 1) {
    if (textAt(worksheet.cells, range.minRow, col).trim() === name) return col;
  }
  return -1;
}

function isNumericText(text) {
  if (text.trim() === "") return false;
  return Number.isFinite(Number(text));
}

function aggregate(records, method) {
  if (method === "COUNT") return records.filter((record) => record.value.trim() !== "").length;
  const numbers = records
    .filter((record) => isNumericText(record.value))
    .map((record) => Number(record.value));
  if (numbers.length === 0) return 0;
  const sum = numbers.reduce((total, value) => total + value, 0);
  return method === "AVERAGE" ? sum / numbers.length : sum;
}

/**
 * Summarizes a source range into the cells of a pivot result worksheet.
 *
 * The pivot only reads the source worksheet: it locates the stored fields by
 * their header text, walks the data rows in source order (skipping blank rows)
 * and returns a fresh cell map. A field whose header is gone, or a SUM/AVERAGE
 * value field without a parseable number, fails with a message and no cells so
 * the caller keeps the last successful result.
 */
export function computePivot(worksheet, pivot) {
  const range = pivot?.sourceRange;
  if (!range) return { ok: false, error: PIVOT_FIELD_MISSING };
  const rowCol = headerColumn(worksheet, range, pivot.rowField);
  const valueCol = headerColumn(worksheet, range, pivot.valueField);
  const hasColumnField = typeof pivot.columnField === "string" && pivot.columnField !== "";
  const columnCol = hasColumnField ? headerColumn(worksheet, range, pivot.columnField) : -1;
  if (rowCol < 0 || valueCol < 0 || (hasColumnField && columnCol < 0)) {
    return { ok: false, error: PIVOT_FIELD_MISSING };
  }

  const records = [];
  for (let row = range.minRow + 1; row <= range.maxRow; row += 1) {
    let hasContent = false;
    for (let col = range.minCol; col <= range.maxCol; col += 1) {
      if (textAt(worksheet.cells, row, col).trim() !== "") {
        hasContent = true;
        break;
      }
    }
    if (!hasContent) continue;
    records.push({
      row: textAt(worksheet.cells, row, rowCol),
      column: hasColumnField ? textAt(worksheet.cells, row, columnCol) : "",
      value: textAt(worksheet.cells, row, valueCol),
    });
  }

  const method = PIVOT_SUMMARIZE_METHODS.includes(pivot.summarizeBy) ? pivot.summarizeBy : "SUM";
  if (method !== "COUNT" && !records.some((record) => isNumericText(record.value))) {
    return { ok: false, error: PIVOT_NUMERIC_REQUIRED };
  }

  const rowValues = [];
  const columnValues = [];
  for (const record of records) {
    if (!rowValues.includes(record.row)) rowValues.push(record.row);
    if (hasColumnField && !columnValues.includes(record.column)) columnValues.push(record.column);
  }
  const matchingRow = (rowValue) => records.filter((record) => record.row === rowValue);
  const matchingColumn = (columnValue) =>
    records.filter((record) => record.column === columnValue);
  const matchingCell = (rowValue, columnValue) =>
    records.filter((record) => record.row === rowValue && record.column === columnValue);

  const cells = {};
  const put = (row, col, value) => {
    cells[cellCoordinate(row, col)] = String(value);
  };

  put(0, 0, pivot.rowField);
  if (!hasColumnField) {
    put(0, 1, `${method} of ${pivot.valueField}`);
    rowValues.forEach((rowValue, index) => {
      put(index + 1, 0, rowValue);
      put(index + 1, 1, aggregate(matchingRow(rowValue), method));
    });
    const totalRow = rowValues.length + 1;
    put(totalRow, 0, "Grand Total");
    put(totalRow, 1, aggregate(records, method));
    return { ok: true, cells };
  }

  columnValues.forEach((columnValue, index) => put(0, index + 1, columnValue));
  const totalCol = columnValues.length + 1;
  put(0, totalCol, "Grand Total");
  rowValues.forEach((rowValue, index) => {
    const row = index + 1;
    put(row, 0, rowValue);
    columnValues.forEach((columnValue, colIndex) => {
      put(row, colIndex + 1, aggregate(matchingCell(rowValue, columnValue), method));
    });
    put(row, totalCol, aggregate(matchingRow(rowValue), method));
  });
  const totalRow = rowValues.length + 1;
  put(totalRow, 0, "Grand Total");
  columnValues.forEach((columnValue, colIndex) => {
    put(totalRow, colIndex + 1, aggregate(matchingColumn(columnValue), method));
  });
  put(totalRow, totalCol, aggregate(records, method));
  return { ok: true, cells };
}

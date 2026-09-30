import { DEFAULT_COLUMN_COUNT, DEFAULT_ROW_COUNT, makeCellId, readRegion } from "./cells.mjs";
import { WorkbookError } from "./errors.mjs";

/**
 * Basic pivot summarization (REQ-5-3-1). A pivot table belongs to its own result worksheet and only
 * reads the source worksheet: the source range with its header row names the row field, the optional
 * column field and the value field, and the computed summary is written into the result worksheet's
 * cells. `SUM`/`AVERAGE` aggregate the parseable numbers of the value field, `COUNT` counts the
 * records with a non-empty value field; the source cells are never written.
 */

export const PIVOT_SUMMARIES = Object.freeze(["SUM", "COUNT", "AVERAGE"]);
export const GRAND_TOTAL_LABEL = "Grand Total";
export const BLANK_GROUP_LABEL = "(blank)";
export const MISSING_PIVOT_FIELD_MESSAGE = "Pivot field is no longer available. Select a new field.";
export const NUMERIC_VALUE_FIELD_MESSAGE = "Value field requires numeric values";
export const MISSING_PIVOT_SELECTION_MESSAGE = "Select the row field and the value field of the pivot table.";
export const INVALID_PIVOT_SOURCE_MESSAGE = "The pivot source range is no longer available.";
export const NOT_A_PIVOT_MESSAGE = "This worksheet is not a pivot table.";
export const PIVOT_RANGE_REQUIRED_MESSAGE = "Select a range with a header row to create a pivot table.";

/** A selected field is stored as the header text of its source column, or as null when unused. */
function readFieldName(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Reads the pivot configuration stored in the state document; a malformed record is dropped. */
export function readStoredPivot(value) {
  if (!value || typeof value !== "object") return null;
  const sourceWorksheetId = typeof value.sourceWorksheetId === "string" ? value.sourceWorksheetId : "";
  const sourceRange = readRegion(value.sourceRange);
  if (sourceWorksheetId === "" || !sourceRange) return null;
  const requested = typeof value.summarizeBy === "string" ? value.summarizeBy.trim().toUpperCase() : "";
  return {
    sourceWorksheetId,
    sourceRange,
    rows: readFieldName(value.rows),
    columns: readFieldName(value.columns),
    values: readFieldName(value.values),
    summarizeBy: PIVOT_SUMMARIES.includes(requested) ? requested : "SUM",
  };
}

/** The pivot configuration a freshly created result worksheet starts with: no field selected yet. */
export function createPivotConfig(sourceWorksheetId, sourceRange) {
  return {
    sourceWorksheetId,
    sourceRange,
    rows: null,
    columns: null,
    values: null,
    summarizeBy: "SUM",
  };
}

/** Merges the field selection of one `Apply` into the stored configuration. */
export function normalizePivotConfig(payload, stored) {
  const requested = typeof payload?.summarizeBy === "string" ? payload.summarizeBy.trim().toUpperCase() : "";
  if (requested !== "" && !PIVOT_SUMMARIES.includes(requested)) {
    throw new WorkbookError("Unknown summarization method");
  }
  const pick = (key) => (payload && key in payload ? readFieldName(payload[key]) : stored[key]);
  return {
    ...stored,
    rows: pick("rows"),
    columns: pick("columns"),
    values: pick("values"),
    summarizeBy: requested === "" ? stored.summarizeBy : requested,
  };
}

function displayedText(cells, cellId) {
  const cell = cells?.[cellId];
  if (!cell) return "";
  if (typeof cell.display === "string") return cell.display;
  return typeof cell.value === "string" ? cell.value : "";
}

function parseNumber(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Summary numbers are shown without floating point noise. */
function formatNumber(value) {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1e10) / 1e10;
  return String(rounded);
}

function groupLabel(text) {
  return text.trim() === "" ? BLANK_GROUP_LABEL : text;
}

function sheetRowCount(worksheet) {
  return Number.isInteger(worksheet?.rowCount) ? worksheet.rowCount : DEFAULT_ROW_COUNT;
}

function sheetColumnCount(worksheet) {
  return Number.isInteger(worksheet?.columnCount) ? worksheet.columnCount : DEFAULT_COLUMN_COUNT;
}

/**
 * The summary of one pivot configuration: the cells of the result worksheet, its rows and its
 * columns. A selected field whose header no longer exists, a source range without a data row, or a
 * `SUM`/`AVERAGE` value field without a parseable number is refused with the message of the
 * requirement, so the caller can keep the last successful result.
 */
export function computePivot(source, pivot) {
  const range = readRegion(pivot?.sourceRange);
  if (!source || !range) throw new WorkbookError(INVALID_PIVOT_SOURCE_MESSAGE);
  if (range.bottom <= range.top || range.bottom > sheetRowCount(source) || range.right > sheetColumnCount(source)) {
    throw new WorkbookError(INVALID_PIVOT_SOURCE_MESSAGE);
  }

  const rows = readFieldName(pivot.rows);
  const values = readFieldName(pivot.values);
  const columns = readFieldName(pivot.columns);
  if (!rows || !values) throw new WorkbookError(MISSING_PIVOT_SELECTION_MESSAGE);

  const headerAt = (column) => displayedText(source.cells, makeCellId(range.top, column)).trim();
  const columnOfField = (name) => {
    for (let column = range.left; column <= range.right; column += 1) {
      if (headerAt(column) === name) return column;
    }
    return -1;
  };

  const rowColumn = columnOfField(rows);
  const valueColumn = columnOfField(values);
  const columnColumn = columns ? columnOfField(columns) : -1;
  if (rowColumn < 0 || valueColumn < 0 || (columns && columnColumn < 0)) {
    throw new WorkbookError(MISSING_PIVOT_FIELD_MESSAGE);
  }

  const records = [];
  for (let row = range.top + 1; row <= range.bottom; row += 1) {
    let hasContent = false;
    for (let column = range.left; column <= range.right; column += 1) {
      if (displayedText(source.cells, makeCellId(row, column)) !== "") {
        hasContent = true;
        break;
      }
    }
    if (!hasContent) continue;
    records.push({
      row: groupLabel(displayedText(source.cells, makeCellId(row, rowColumn))),
      column: columnColumn < 0 ? null : groupLabel(displayedText(source.cells, makeCellId(row, columnColumn))),
      value: displayedText(source.cells, makeCellId(row, valueColumn)),
    });
  }

  const summarizeBy = pivot.summarizeBy;
  if (summarizeBy !== "COUNT" && !records.some((record) => parseNumber(record.value) !== null)) {
    throw new WorkbookError(NUMERIC_VALUE_FIELD_MESSAGE);
  }

  const aggregate = (list) => {
    if (summarizeBy === "COUNT") return list.filter((record) => record.value.trim() !== "").length;
    const numbers = list.flatMap((record) => {
      const parsed = parseNumber(record.value);
      return parsed === null ? [] : [parsed];
    });
    if (numbers.length === 0) return 0;
    const total = numbers.reduce((sum, value) => sum + value, 0);
    return summarizeBy === "AVERAGE" ? total / numbers.length : total;
  };

  const rowKeys = [...new Set(records.map((record) => record.row))];
  const columnKeys = columnColumn < 0 ? [] : [...new Set(records.map((record) => record.column))];
  const matching = (rowKey, columnKey) =>
    records.filter(
      (record) => record.row === rowKey && (columnKey === null || record.column === columnKey),
    );

  const text = {};
  text[makeCellId(1, 1)] = rows;
  text[makeCellId(1, 2)] = `${summarizeBy} of ${values}`;

  if (columnColumn < 0) {
    rowKeys.forEach((key, index) => {
      text[makeCellId(index + 2, 1)] = key;
      text[makeCellId(index + 2, 2)] = formatNumber(aggregate(matching(key, null)));
    });
    const totalRow = rowKeys.length + 2;
    text[makeCellId(totalRow, 1)] = GRAND_TOTAL_LABEL;
    text[makeCellId(totalRow, 2)] = formatNumber(aggregate(records));
    return {
      cells: toCells(text),
      rowCount: Math.max(DEFAULT_ROW_COUNT, totalRow),
      columnCount: Math.max(DEFAULT_COLUMN_COUNT, 2),
    };
  }

  columnKeys.forEach((key, index) => {
    text[makeCellId(1, index + 2)] = key;
  });
  const totalColumn = columnKeys.length + 2;
  text[makeCellId(1, totalColumn)] = GRAND_TOTAL_LABEL;

  rowKeys.forEach((key, index) => {
    const rowIndex = index + 2;
    text[makeCellId(rowIndex, 1)] = key;
    columnKeys.forEach((columnKey, columnIndex) => {
      text[makeCellId(rowIndex, columnIndex + 2)] = formatNumber(aggregate(matching(key, columnKey)));
    });
    text[makeCellId(rowIndex, totalColumn)] = formatNumber(aggregate(matching(key, null)));
  });

  const totalRow = rowKeys.length + 2;
  text[makeCellId(totalRow, 1)] = GRAND_TOTAL_LABEL;
  columnKeys.forEach((columnKey, columnIndex) => {
    text[makeCellId(totalRow, columnIndex + 2)] = formatNumber(
      aggregate(records.filter((record) => record.column === columnKey)),
    );
  });
  text[makeCellId(totalRow, totalColumn)] = formatNumber(aggregate(records));

  return {
    cells: toCells(text),
    rowCount: Math.max(DEFAULT_ROW_COUNT, totalRow),
    columnCount: Math.max(DEFAULT_COLUMN_COUNT, totalColumn),
  };
}

function toCells(text) {
  const cells = {};
  for (const [cellId, value] of Object.entries(text)) {
    if (value === "") continue;
    cells[cellId] = { value };
  }
  return cells;
}

/** Header texts of the columns of a source range, used as the accessible names of the options. */
export function sourceHeaders(source, range) {
  const region = readRegion(range);
  if (!source || !region) return [];
  const headers = [];
  for (let column = region.left; column <= region.right; column += 1) {
    const text = displayedText(source.cells, makeCellId(region.top, column));
    if (text.trim() !== "") headers.push(text);
  }
  return headers;
}

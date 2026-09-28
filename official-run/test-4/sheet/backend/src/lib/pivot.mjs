/**
 * Basic pivot summarization (REQ-5-3-1).
 *
 * A pivot result lives in its own worksheet and only reads source data. The
 * pivot sheet persists a configuration (`rowField`, optional `columnField`,
 * `valueField`, `summarizeBy`) plus the summary cells written by the last
 * successful Apply/Refresh; results stay unchanged until the user clicks
 * "Refresh pivot table", at which point the whole summary is recomputed from
 * the current source range.
 *
 * Aggregation rules: SUM/AVERAGE use only parseable numbers (nonnumeric and
 * empty values are skipped), COUNT counts non-empty records in the value
 * field and never fails on nonnumeric content. Row/column groups are ordered
 * by first appearance in the source data; the final row (and final column
 * when a column field is selected) is Grand Total.
 */

import { cellName, formatNumber, parseCoord } from "./formula.mjs";

/** A parseable finite number, or null for empty/nonnumeric text. */
export function parsePivotNumber(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

/**
 * Compute the summary cells for a pivot configuration over a source
 * rectangle. Returns `{ cells, error }`: on error `cells` is null and the
 * caller must preserve the last successful result (and the source worksheet)
 * unchanged. `sourceResults` is the derived formula-result map of the source
 * sheet (formula cells only); data cells fall back to the stored text.
 */
export function computePivotCells(sourceCells, sourceResults, range, config) {
  const from = parseCoord(range.start);
  const to = parseCoord(range.end);
  if (!from || !to) return { cells: null, error: "Invalid source range" };
  const rowMin = Math.min(from.row, to.row);
  const rowMax = Math.max(from.row, to.row);
  const colMin = Math.min(from.col, to.col);
  const colMax = Math.max(from.col, to.col);
  if (rowMax < 1 || colMax < 0 || rowMax < rowMin || colMax < colMin) {
    return { cells: null, error: "Invalid source range" };
  }

  const { rowField, columnField, valueField, summarizeBy } = config;
  if (typeof rowField !== "string" || rowField === "") {
    return { cells: null, error: "Row field is required" };
  }
  if (typeof valueField !== "string" || valueField === "") {
    return { cells: null, error: "Value field is required" };
  }
  if (summarizeBy !== "SUM" && summarizeBy !== "COUNT" && summarizeBy !== "AVERAGE") {
    return { cells: null, error: "Invalid summarization method" };
  }
  if (columnField !== null && columnField !== undefined && typeof columnField !== "string") {
    return { cells: null, error: "Invalid column field" };
  }

  // Locate the selected fields by header text in the current source range.
  const headerRow = rowMin;
  const headerColumns = new Map();
  for (let col = colMin; col <= colMax; col += 1) {
    const coord = cellName(headerRow, col);
    const text = ((sourceResults[coord] ?? sourceCells[coord]) ?? "").trim();
    if (text !== "" && !headerColumns.has(text)) headerColumns.set(text, col);
  }
  const columnOf = (text) => (text ? headerColumns.get(text) ?? null : null);
  const rowCol = columnOf(rowField);
  const valueCol = columnOf(valueField);
  const columnCol = columnField ? columnOf(columnField) : null;
  if (rowCol === null || valueCol === null || (columnField && columnCol === null)) {
    return {
      cells: null,
      error: "Pivot field is no longer available. Select a new field.",
    };
  }

  const read = (row, col) => {
    const coord = cellName(row, col);
    return (sourceResults[coord] ?? sourceCells[coord]) ?? "";
  };

  // Collect qualifying records: rows inside the range with a non-empty row
  // field, in source order.
  const records = [];
  let numericValueCount = 0;
  for (let row = rowMin + 1; row <= rowMax; row += 1) {
    const rowValue = read(row, rowCol).trim();
    if (rowValue === "") continue;
    const value = read(row, valueCol);
    if (parsePivotNumber(value) !== null) numericValueCount += 1;
    records.push({
      rowValue,
      columnValue: columnField ? read(row, columnCol) : null,
      value,
    });
  }

  if ((summarizeBy === "SUM" || summarizeBy === "AVERAGE") && numericValueCount === 0) {
    return { cells: null, error: "Value field requires numeric values" };
  }

  // Row/column groups ordered by first appearance.
  const rowGroups = [];
  const rowGroupIndex = new Map();
  const columnGroups = [];
  const columnGroupIndex = new Map();
  for (const record of records) {
    if (!rowGroupIndex.has(record.rowValue)) {
      rowGroupIndex.set(record.rowValue, rowGroups.length);
      rowGroups.push(record.rowValue);
    }
    if (columnField) {
      const key = record.columnValue ?? "";
      if (!columnGroupIndex.has(key)) {
        columnGroupIndex.set(key, columnGroups.length);
        columnGroups.push(key);
      }
    }
  }

  function aggregate(values) {
    if (summarizeBy === "COUNT") {
      return values.filter((value) => value !== "").length;
    }
    const numbers = [];
    for (const value of values) {
      const number = parsePivotNumber(value);
      if (number !== null) numbers.push(number);
    }
    if (summarizeBy === "SUM") {
      return numbers.reduce((sum, number) => sum + number, 0);
    }
    // AVERAGE
    return numbers.length === 0
      ? 0
      : numbers.reduce((sum, number) => sum + number, 0) / numbers.length;
  }

  const fmt = (value) => (typeof value === "number" ? formatNumber(value) : String(value));
  const valuesOf = (items) => items.map((record) => record.value);
  const cells = {};

  if (!columnField) {
    cells.A1 = rowField;
    cells.B1 = `${summarizeBy} of ${valueField}`;
    let row = 2;
    for (const group of rowGroups) {
      const groupRecords = records.filter((record) => record.rowValue === group);
      cells[cellName(row, 0)] = group;
      cells[cellName(row, 1)] = fmt(aggregate(valuesOf(groupRecords)));
      row += 1;
    }
    cells[cellName(row, 0)] = "Grand Total";
    cells[cellName(row, 1)] = fmt(aggregate(valuesOf(records)));
    return { cells, error: null };
  }

  cells.A1 = rowField;
  let col = 1;
  for (const group of columnGroups) {
    cells[cellName(1, col)] = group;
    col += 1;
  }
  const grandTotalCol = col;
  cells[cellName(1, grandTotalCol)] = "Grand Total";

  let row = 2;
  for (const group of rowGroups) {
    const rowRecords = records.filter((record) => record.rowValue === group);
    cells[cellName(row, 0)] = group;
    columnGroups.forEach((columnGroup, index) => {
      const comboRecords = rowRecords.filter(
        (record) => (record.columnValue ?? "") === columnGroup,
      );
      cells[cellName(row, index + 1)] = fmt(aggregate(valuesOf(comboRecords)));
    });
    cells[cellName(row, grandTotalCol)] = fmt(aggregate(valuesOf(rowRecords)));
    row += 1;
  }

  cells[cellName(row, 0)] = "Grand Total";
  columnGroups.forEach((columnGroup, index) => {
    const columnRecords = records.filter(
      (record) => (record.columnValue ?? "") === columnGroup,
    );
    cells[cellName(row, index + 1)] = fmt(aggregate(valuesOf(columnRecords)));
  });
  cells[cellName(row, grandTotalCol)] = fmt(aggregate(valuesOf(records)));
  return { cells, error: null };
}

/**
 * Shift a pivot source range with a row/column structure operation so the
 * configuration keeps covering the same data after cells move. The stored
 * summary cells are NOT recomputed here — results stay unchanged until
 * "Refresh pivot table" is clicked (REQ-2-2-1/REQ-2-2-2).
 */
export function shiftPivotRange(range, op) {
  const from = parseCoord(range.start);
  const to = parseCoord(range.end);
  if (!from || !to) return range;
  let rowMin = Math.min(from.row, to.row);
  let rowMax = Math.max(from.row, to.row);
  let colMin = Math.min(from.col, to.col);
  let colMax = Math.max(from.col, to.col);

  if (op.axis === "row") {
    if (op.insert !== undefined) {
      if (rowMin >= op.insert) rowMin += 1;
      if (rowMax >= op.insert) rowMax += 1;
    } else if (op.delete !== undefined) {
      if (rowMin > op.delete) rowMin -= 1;
      if (rowMax >= op.delete) rowMax -= 1;
    }
  } else {
    if (op.insert !== undefined) {
      if (colMin >= op.insert) colMin += 1;
      if (colMax >= op.insert) colMax += 1;
    } else if (op.delete !== undefined) {
      if (colMin > op.delete) colMin -= 1;
      if (colMax >= op.delete) colMax -= 1;
    }
  }

  rowMin = Math.max(1, rowMin);
  colMin = Math.max(0, colMin);
  if (rowMax < rowMin) rowMax = rowMin;
  if (colMax < colMin) colMax = colMin;
  return { start: cellName(rowMin, colMin), end: cellName(rowMax, colMax) };
}

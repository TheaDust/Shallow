import type { CellMap, PivotConfig, PivotSummarizeBy, Sheet } from './types';
import { coordinateToCell } from './gridUtils';
import { parseRange } from './rowColOps';

// Pure pivot-table logic (REQ-5-3-1). A pivot reads a source range of the
// current worksheet (headers in the first row) and aggregates the value
// field by one row field and one optional column field. The summary cells
// live in a separate pivot-result worksheet; the source worksheet is never
// modified. SUM/AVERAGE aggregate only parseable numbers; COUNT counts
// non-empty records in the value field and does not fail on nonnumeric
// content. Row groups and column-field values are ordered by first
// appearance in the source data; the final row (and final column when a
// column field is selected) is Grand Total.

export const PIVOT_FIELD_MISSING =
  'Pivot field is no longer available. Select a new field.';
export const PIVOT_NUMERIC_ERROR = 'Value field requires numeric values';
export const GRAND_TOTAL = 'Grand Total';

// The first unused PivotN name in positive-integer order (Pivot1, Pivot2, …),
// ignoring existing worksheet names.
export function nextPivotName(sheetNames: string[]): string {
  let n = 1;
  const names = new Set(sheetNames.map((name) => name.trim()));
  while (names.has(`Pivot${n}`)) {
    n += 1;
  }
  return `Pivot${n}`;
}

const NUMERIC_TEXT = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;

// The parseable-number check used by SUM/AVERAGE: a trimmed decimal literal
// (optionally signed). Anything else (text, dates, percentages, formulas) is
// not a parseable number.
export function parseableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!NUMERIC_TEXT.test(trimmed)) {
    return null;
  }
  return Number(trimmed);
}

// Header texts of the range's first row (one entry per column).
export function headerTextsInRange(sheet: Sheet, range: string): string[] {
  const r = parseRange(range);
  if (!r) {
    return [];
  }
  const headers: string[] = [];
  for (let col = r.startCol; col <= r.endCol; col += 1) {
    headers.push(sheet.cells[coordinateToCell(r.startRow, col)] ?? '');
  }
  return headers;
}

export interface PivotComputeOutcome {
  ok: true;
  cells: CellMap;
  maxRow: number; // 0-based inclusive extent of the summary
  maxCol: number;
}

export interface PivotComputeError {
  ok: false;
  error: string;
}

interface PivotRecord {
  rowValue: string;
  colValue: string | null;
  value: string;
}

// Aggregates the value-field entries of one row/column combination. COUNT
// counts non-empty entries (displaying 0 when there are none); SUM/AVERAGE
// use only parseable numbers and display an empty cell when the combination
// has no parseable numbers.
function aggregate(values: string[], summarizeBy: PivotSummarizeBy): string {
  if (summarizeBy === 'COUNT') {
    return String(values.filter((v) => v.trim() !== '').length);
  }
  const numbers = values
    .map((v) => parseableNumber(v))
    .filter((n): n is number => n !== null);
  if (numbers.length === 0) {
    return '';
  }
  if (summarizeBy === 'SUM') {
    return String(numbers.reduce((sum, n) => sum + n, 0));
  }
  return String(numbers.reduce((sum, n) => sum + n, 0) / numbers.length);
}

function firstAppearanceOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      ordered.push(value);
    }
  }
  return ordered;
}

export function computePivot(
  sheet: Sheet,
  range: string,
  config: PivotConfig
): PivotComputeOutcome | PivotComputeError {
  const r = parseRange(range);
  if (!r || r.startRow >= r.endRow) {
    return { ok: false, error: 'Invalid source range' };
  }
  const headers = headerTextsInRange(sheet, range);
  const findColumn = (field: string): number | null => {
    const index = headers.indexOf(field);
    return index < 0 ? null : r.startCol + index;
  };
  const rowCol = findColumn(config.rowField);
  const valueCol = findColumn(config.valueField);
  const columnCol = config.columnField
    ? findColumn(config.columnField)
    : null;
  if (
    rowCol === null ||
    valueCol === null ||
    (config.columnField && columnCol === null)
  ) {
    return { ok: false, error: PIVOT_FIELD_MISSING };
  }

  const records: PivotRecord[] = [];
  for (let row = r.startRow + 1; row <= r.endRow; row += 1) {
    const rowValue = sheet.cells[coordinateToCell(row, rowCol)] ?? '';
    const colValue =
      columnCol === null
        ? null
        : (sheet.cells[coordinateToCell(row, columnCol)] ?? '');
    const value = sheet.cells[coordinateToCell(row, valueCol)] ?? '';
    // Completely blank rows inside the range are not records; they must not
    // create empty row groups or pollute the Grand Total.
    if (
      rowValue.trim() === '' &&
      (colValue === null || colValue.trim() === '') &&
      value.trim() === ''
    ) {
      continue;
    }
    records.push({ rowValue, colValue, value });
  }

  // SUM/AVERAGE require at least one parseable number somewhere in the value
  // field; COUNT works on any content.
  if (config.summarizeBy === 'SUM' || config.summarizeBy === 'AVERAGE') {
    const anyNumeric = records.some(
      (record) => parseableNumber(record.value) !== null
    );
    if (!anyNumeric) {
      return { ok: false, error: PIVOT_NUMERIC_ERROR };
    }
  }

  const cells: CellMap = {};
  const setCell = (row: number, col: number, value: string) => {
    cells[coordinateToCell(row, col)] = value;
  };

  if (columnCol === null) {
    // No column field: A1 = row-field name, B1 = "<METHOD> of <value field>",
    // one row per row group (first appearance), final row Grand Total.
    setCell(0, 0, config.rowField);
    setCell(0, 1, `${config.summarizeBy} of ${config.valueField}`);
    const rowValues = firstAppearanceOrder(records.map((record) => record.rowValue));
    let rowIndex = 1;
    for (const rowValue of rowValues) {
      const group = records.filter((record) => record.rowValue === rowValue);
      setCell(rowIndex, 0, rowValue);
      setCell(rowIndex, 1, aggregate(group.map((record) => record.value), config.summarizeBy));
      rowIndex += 1;
    }
    setCell(rowIndex, 0, GRAND_TOTAL);
    setCell(
      rowIndex,
      1,
      aggregate(records.map((record) => record.value), config.summarizeBy)
    );
    return {
      ok: true,
      cells,
      maxRow: rowIndex,
      maxCol: 1,
    };
  }

  // With a column field: A1 = row-field name, column-field values from B1
  // onward in first-appearance order, final column Grand Total; row-field
  // values likewise ordered by first appearance with Grand Total as the
  // final row.
  const rowValues = firstAppearanceOrder(records.map((record) => record.rowValue));
  const colValues = firstAppearanceOrder(
    records.map((record) => record.colValue ?? '')
  );
  setCell(0, 0, config.rowField);
  for (let col = 0; col < colValues.length; col += 1) {
    setCell(0, col + 1, colValues[col]);
  }
  setCell(0, colValues.length + 1, GRAND_TOTAL);
  let rowIndex = 1;
  for (const rowValue of rowValues) {
    setCell(rowIndex, 0, rowValue);
    const rowRecords = records.filter((record) => record.rowValue === rowValue);
    for (let col = 0; col < colValues.length; col += 1) {
      const combo = rowRecords.filter(
        (record) => (record.colValue ?? '') === colValues[col]
      );
      setCell(
        rowIndex,
        col + 1,
        aggregate(
          combo.map((record) => record.value),
          config.summarizeBy
        )
      );
    }
    setCell(
      rowIndex,
      colValues.length + 1,
      aggregate(
        rowRecords.map((record) => record.value),
        config.summarizeBy
      )
    );
    rowIndex += 1;
  }
  setCell(rowIndex, 0, GRAND_TOTAL);
  for (let col = 0; col < colValues.length; col += 1) {
    const colRecords = records.filter(
      (record) => (record.colValue ?? '') === colValues[col]
    );
    setCell(
      rowIndex,
      col + 1,
      aggregate(
        colRecords.map((record) => record.value),
        config.summarizeBy
      )
    );
  }
  setCell(
    rowIndex,
    colValues.length + 1,
    aggregate(
      records.map((record) => record.value),
      config.summarizeBy
    )
  );
  return {
    ok: true,
    cells,
    maxRow: rowIndex,
    maxCol: colValues.length + 1,
  };
}

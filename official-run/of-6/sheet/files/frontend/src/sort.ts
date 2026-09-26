import type { CellMap, Sheet } from './types';
import { cellToCoordinate, coordinateToCell } from './gridUtils';
import { parseRange } from './rowColOps';

// Sorting logic for REQ-5-1-1.
//
// A user selects a rectangular range in the active worksheet and sorts it by
// one of its columns ("Sort range" in the Data menu). Sorting physically
// reorders the records inside the selected range: each row of the range moves
// as a whole, cells outside the range are never touched, and the resulting
// order is persisted with the worksheet. The first row can be declared a
// header ("Data has header row"), in which case it does not participate.
//
// Sort keys follow the cell's own type: numbers compare numerically,
// parseable dates compare chronologically (their timestamps), and text
// compares lexically (case-insensitive, with the raw text as the tiebreak).
// Equal sort keys keep their original relative order (stable sort). Empty
// rows always sort last regardless of the chosen order, like common
// spreadsheet applications.

export type SortOrder = 'ascending' | 'descending';

export interface SortOptions {
  // 0-based worksheet column index to sort by.
  column: number;
  order: SortOrder;
  hasHeader: boolean;
}

export type SortOutcome = { sheet: Sheet } | { error: string };

const NUMERIC_TEXT = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;

export type SortKey =
  | { kind: 'empty' }
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string };

// Classifies a cell value into a comparable sort key. Parseable dates are
// represented as numbers (their timestamp) so they compare chronologically.
export function sortKeyOf(value: string): SortKey {
  const trimmed = value.trim();
  if (trimmed === '') {
    return { kind: 'empty' };
  }
  if (NUMERIC_TEXT.test(trimmed)) {
    return { kind: 'number', value: Number(trimmed) };
  }
  const time = Date.parse(trimmed);
  if (!Number.isNaN(time)) {
    return { kind: 'number', value: time };
  }
  return { kind: 'text', value: trimmed };
}

// Compares two sort keys in the requested order. Empty cells always sort
// last (ascending and descending); numbers (including parseable dates) sort
// before text; equal keys compare as 0 so the caller's stable tiebreak
// preserves their original relative order.
export function compareSortKeys(a: SortKey, b: SortKey, order: SortOrder): number {
  if (a.kind === 'empty' && b.kind === 'empty') {
    return 0;
  }
  if (a.kind === 'empty') {
    return 1;
  }
  if (b.kind === 'empty') {
    return -1;
  }
  const direction = order === 'descending' ? -1 : 1;
  let cmp: number;
  if (a.kind === 'number' && b.kind === 'number') {
    cmp = a.value - b.value;
  } else if (a.kind === 'text' && b.kind === 'text') {
    cmp = a.value.localeCompare(b.value, undefined, { sensitivity: 'base' });
    if (cmp === 0) {
      cmp = a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
    }
  } else {
    // Numbers (including parseable dates) sort before text in both orders.
    return a.kind === 'number' ? -1 : 1;
  }
  return cmp * direction;
}

// Reorders the rows inside `range` of `sheet` by the given column. Only the
// rectangle's own cells move; cells outside the range (other columns of the
// same rows, rows outside the range, other worksheets) stay untouched. The
// returned sheet shares every other property (filter views, validation
// rules, selection, dimensions) unchanged, so filtering and validation keep
// applying to the same selected range.
export function sortSheetRange(
  sheet: Sheet,
  range: string,
  options: SortOptions
): SortOutcome {
  const r = parseRange(range);
  if (!r) {
    return { error: 'Invalid range' };
  }
  if (options.column < r.startCol || options.column > r.endCol) {
    return { error: 'Sort column is outside the selected range' };
  }
  const firstDataRow = options.hasHeader ? r.startRow + 1 : r.startRow;
  if (firstDataRow > r.endRow) {
    return { sheet }; // the range holds no data rows: sorting is a no-op
  }
  const keyColumn = options.column;
  const keyIndex = keyColumn - r.startCol;
  const rows: Array<{ index: number; record: string[] }> = [];
  for (let row = firstDataRow; row <= r.endRow; row += 1) {
    const record: string[] = [];
    for (let col = r.startCol; col <= r.endCol; col += 1) {
      record.push(sheet.cells[coordinateToCell(row, col)] ?? '');
    }
    rows.push({ index: row, record });
  }
  if (rows.length < 2) {
    return { sheet }; // nothing to reorder
  }

  const sorted = rows
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => {
      const ka = sortKeyOf(a.entry.record[keyIndex] ?? '');
      const kb = sortKeyOf(b.entry.record[keyIndex] ?? '');
      const cmp = compareSortKeys(ka, kb, options.order);
      // Equal sort keys preserve their original relative order.
      return cmp !== 0 ? cmp : a.i - b.i;
    })
    .map((pair) => pair.entry);

  const nextCells: CellMap = {};
  for (const [coord, value] of Object.entries(sheet.cells)) {
    const c = cellToCoordinate(coord);
    if (!c) {
      continue;
    }
    if (
      c.row >= r.startRow &&
      c.row <= r.endRow &&
      c.column >= r.startCol &&
      c.column <= r.endCol
    ) {
      continue; // rewritten below from the sorted records
    }
    nextCells[coord] = value;
  }
  for (let row = r.startRow; row <= r.endRow; row += 1) {
    const source =
      row < firstDataRow ? null : sorted[row - firstDataRow];
    for (let col = r.startCol; col <= r.endCol; col += 1) {
      const value =
        source === null
          ? (sheet.cells[coordinateToCell(row, col)] ?? '')
          : source.record[col - r.startCol];
      if (value !== '') {
        nextCells[coordinateToCell(row, col)] = value;
      }
    }
  }
  return { sheet: { ...sheet, cells: nextCells } };
}

import type { FilterCondition, FilterView, Sheet } from './types';
import { coordinateToCell } from './gridUtils';
import { parseRange } from './rowColOps';

// Filtering logic for REQ-5-1-2.
//
// A filter view is attached to a data region with headers (its range, e.g.
// "A1:C6"); the first row of the range is the header row and never hides.
// Each criterion constrains one column either by a set of selected source
// values or by a condition. Criteria on different columns are combined with
// AND. Nonmatching rows are hidden only - they are neither deleted nor
// reordered, and CSV export / pivot summarization still read them.

const NUMERIC_TEXT = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;

export function parseNumberValue(text: string): number | null {
  const trimmed = text.trim();
  if (!NUMERIC_TEXT.test(trimmed)) {
    return null;
  }
  return Number(trimmed);
}

export function parseDateValue(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const time = Date.parse(trimmed);
  return Number.isNaN(time) ? null : time;
}

export function matchesFilterCondition(
  value: string,
  condition: FilterCondition,
  filterValue: string
): boolean {
  switch (condition) {
    case 'text-contains': {
      return value
        .toLocaleLowerCase()
        .includes(filterValue.trim().toLocaleLowerCase());
    }
    case 'greater-than': {
      const cellNumber = parseNumberValue(value);
      const filterNumber = parseNumberValue(filterValue);
      if (cellNumber === null || filterNumber === null) {
        return false;
      }
      return cellNumber > filterNumber;
    }
    case 'before': {
      const cellDate = parseDateValue(value);
      const filterDate = parseDateValue(filterValue);
      if (cellDate === null || filterDate === null) {
        return false;
      }
      return cellDate < filterDate;
    }
    case 'is-empty':
      return value === '';
    case 'is-not-empty':
      return value !== '';
    default:
      return true;
  }
}

// Distinct non-empty source values in a range column (data rows only, after
// the header row), in order of first appearance.
export function distinctValuesInColumn(
  sheet: Sheet,
  range: string,
  column: number
): string[] {
  const r = parseRange(range);
  if (!r || column < r.startCol || column > r.endCol) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (let row = r.startRow + 1; row <= r.endRow; row += 1) {
    const coord = coordinateToCell(row, column);
    const value = sheet.cells[coord] ?? '';
    if (value === '' || seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}

// Whether a single data row passes every criterion of the filter. Rows with
// no applicable criterion always pass.
export function filterMatchesRow(
  sheet: Sheet,
  filter: FilterView,
  row: number
): boolean {
  const criteria = filter.criteria ?? [];
  for (const criterion of criteria) {
    if (criterion.column < 0 || criterion.column >= sheet.columnCount) {
      continue;
    }
    const coord = coordinateToCell(row, criterion.column);
    const value = sheet.cells[coord] ?? '';
    if (Array.isArray(criterion.selectedValues)) {
      if (!criterion.selectedValues.includes(value)) {
        return false;
      }
    } else if (criterion.condition) {
      if (!matchesFilterCondition(value, criterion.condition, criterion.value ?? '')) {
        return false;
      }
    }
  }
  return true;
}

// True when the row must be hidden: it lies inside the filter range's data
// rows (not the header row) and fails the criteria. Rows outside the range
// and the header row stay visible.
export function rowIsFilteredOut(
  sheet: Sheet,
  filter: FilterView | null,
  row: number
): boolean {
  if (!filter || !filter.range) {
    return false;
  }
  const r = parseRange(filter.range);
  if (!r) {
    return false;
  }
  if (row < r.startRow || row > r.endRow) {
    return false;
  }
  if (row === r.startRow) {
    return false; // header row always stays visible
  }
  return !filterMatchesRow(sheet, filter, row);
}

// Whether the grid cell at (row, column) is a header cell of the active
// filter range and therefore exposes a "Filter <header text>" button.
export function isFilterHeaderCell(
  filter: FilterView | null,
  row: number,
  column: number
): boolean {
  if (!filter || !filter.range) {
    return false;
  }
  const r = parseRange(filter.range);
  if (!r) {
    return false;
  }
  return (
    row === r.startRow && column >= r.startCol && column <= r.endCol
  );
}

// The active filter of a worksheet: the most recently created filter view.
export function activeFilterOf(sheet: Sheet): FilterView | null {
  if (sheet.filterViews.length === 0) {
    return null;
  }
  return sheet.filterViews[sheet.filterViews.length - 1];
}

import { describe, expect, it } from 'vitest';
import type { FilterView, Sheet } from './types';
import {
  activeFilterOf,
  distinctValuesInColumn,
  filterMatchesRow,
  isFilterHeaderCell,
  matchesFilterCondition,
  rowIsFilteredOut,
} from './filter';

function makeSheet(cells: Record<string, string> = {}): Sheet {
  return {
    id: 'sheet1',
    name: 'Sheet1',
    rowCount: 6,
    columnCount: 3,
    cells,
    filterViews: [],
    validationRules: [],
  };
}

const sheet = makeSheet({
  A1: 'Region',
  B1: 'Sales',
  C1: 'Status',
  A2: 'East',
  B2: '1200',
  C2: 'Open',
  A3: 'North',
  B3: '800',
  C3: 'Closed',
  A4: 'South',
  B4: '700',
  C4: 'Open',
});

describe('distinctValuesInColumn', () => {
  it('returns distinct non-empty values in first-appearance order, data rows only', () => {
    expect(distinctValuesInColumn(sheet, 'A1:C6', 0)).toEqual(['East', 'North', 'South']);
    expect(distinctValuesInColumn(sheet, 'A1:C6', 1)).toEqual(['1200', '800', '700']);
    expect(distinctValuesInColumn(sheet, 'A1:C6', 2)).toEqual(['Open', 'Closed']);
  });

  it('excludes the header row and empty cells', () => {
    const s = makeSheet({ A1: 'Header', A2: 'x', A4: 'x', A5: 'y' });
    expect(distinctValuesInColumn(s, 'A1:A6', 0)).toEqual(['x', 'y']);
  });

  it('returns [] for a column outside the range', () => {
    expect(distinctValuesInColumn(sheet, 'A1:A6', 1)).toEqual([]);
  });
});

describe('matchesFilterCondition', () => {
  it('Text contains matches case-insensitively as a substring', () => {
    expect(matchesFilterCondition('East', 'text-contains', 'ea')).toBe(true);
    expect(matchesFilterCondition('East', 'text-contains', 'EAST')).toBe(true);
    expect(matchesFilterCondition('East', 'text-contains', 'xyz')).toBe(false);
  });

  it('Greater than compares numeric values; non-numbers never match', () => {
    expect(matchesFilterCondition('1200', 'greater-than', '900')).toBe(true);
    expect(matchesFilterCondition('800', 'greater-than', '900')).toBe(false);
    expect(matchesFilterCondition('East', 'greater-than', '900')).toBe(false);
    expect(matchesFilterCondition('', 'greater-than', '900')).toBe(false);
  });

  it('Before compares parseable dates; unparseable values never match', () => {
    expect(matchesFilterCondition('2024-01-15', 'before', '2024-06-01')).toBe(true);
    expect(matchesFilterCondition('2024-08-01', 'before', '2024-06-01')).toBe(false);
    expect(matchesFilterCondition('Open', 'before', '2024-06-01')).toBe(false);
  });

  it('Is empty and Is not empty require no value operand', () => {
    expect(matchesFilterCondition('', 'is-empty', '')).toBe(true);
    expect(matchesFilterCondition('Open', 'is-empty', '')).toBe(false);
    expect(matchesFilterCondition('Open', 'is-not-empty', '')).toBe(true);
    expect(matchesFilterCondition('', 'is-not-empty', '')).toBe(false);
  });
});

describe('filterMatchesRow / rowIsFilteredOut', () => {
  it('a value criterion keeps only rows whose cell value is selected', () => {
    const filter: FilterView = {
      id: 'fv1',
      name: 'Filter view 1',
      range: 'A1:C6',
      criteria: [{ column: 0, selectedValues: ['East'] }],
    };
    expect(filterMatchesRow(sheet, filter, 1)).toBe(true); // row 2 East
    expect(filterMatchesRow(sheet, filter, 2)).toBe(false); // row 3 North
    expect(filterMatchesRow(sheet, filter, 3)).toBe(false); // row 4 South
  });

  it('conditions on different columns are combined with AND', () => {
    const filter: FilterView = {
      id: 'fv1',
      name: 'Filter view 1',
      range: 'A1:C6',
      criteria: [
        { column: 0, selectedValues: ['East'] },
        { column: 1, condition: 'greater-than', value: '900' },
      ],
    };
    expect(filterMatchesRow(sheet, filter, 1)).toBe(true); // East + 1200
    expect(filterMatchesRow(sheet, filter, 2)).toBe(false); // North + 800
    expect(filterMatchesRow(sheet, filter, 3)).toBe(false); // South + 700
  });

  it('an empty selectedValues hides every data row of the column', () => {
    const filter: FilterView = {
      id: 'fv1',
      name: 'Filter view 1',
      range: 'A1:C6',
      criteria: [{ column: 0, selectedValues: [] }],
    };
    expect(filterMatchesRow(sheet, filter, 1)).toBe(false);
    expect(filterMatchesRow(sheet, filter, 2)).toBe(false);
  });

  it('rowIsFilteredOut keeps the header row and rows outside the range visible', () => {
    const filter: FilterView = {
      id: 'fv1',
      name: 'Filter view 1',
      range: 'A1:C6',
      criteria: [{ column: 0, selectedValues: ['East'] }],
    };
    expect(rowIsFilteredOut(sheet, filter, 0)).toBe(false); // header row
    expect(rowIsFilteredOut(sheet, filter, 1)).toBe(false); // East row
    expect(rowIsFilteredOut(sheet, filter, 2)).toBe(true); // North row

    // a taller sheet lets rows below the range stay visible
    const tall = makeSheet({ A1: 'Region', A2: 'East' });
    tall.rowCount = 9;
    expect(rowIsFilteredOut(tall, filter, 6)).toBe(false); // row 7 outside A1:C6
    expect(rowIsFilteredOut(tall, filter, 8)).toBe(false); // row 9 outside A1:C6
  });

  it('rowIsFilteredOut is false when there is no filter or no criteria', () => {
    expect(rowIsFilteredOut(sheet, null, 2)).toBe(false);
    expect(
      rowIsFilteredOut(sheet, { id: 'fv1', name: 'F', range: 'A1:C6', criteria: [] }, 2)
    ).toBe(false);
  });
});

describe('isFilterHeaderCell / activeFilterOf', () => {
  it('marks only the header-row cells of the active range', () => {
    const filter: FilterView = { id: 'fv1', name: 'F', range: 'A1:C6', criteria: [] };
    expect(isFilterHeaderCell(filter, 0, 0)).toBe(true);
    expect(isFilterHeaderCell(filter, 0, 2)).toBe(true);
    expect(isFilterHeaderCell(filter, 1, 0)).toBe(false);
    expect(isFilterHeaderCell(filter, 0, 3)).toBe(false);
    expect(isFilterHeaderCell(null, 0, 0)).toBe(false);
  });

  it('activeFilterOf returns the most recently created filter view', () => {
    const s: Sheet = {
      ...sheet,
      filterViews: [
        { id: 'fv1', name: 'First', range: 'A1:C6' },
        { id: 'fv2', name: 'Second', range: 'A1:C6' },
      ],
    };
    expect(activeFilterOf(s)?.id).toBe('fv2');
    expect(activeFilterOf(makeSheet())).toBeNull();
  });
});

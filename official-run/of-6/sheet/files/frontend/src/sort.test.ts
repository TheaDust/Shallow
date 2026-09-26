import { describe, expect, it } from 'vitest';
import { compareSortKeys, sortKeyOf, sortSheetRange } from './sort';
import type { Sheet } from './types';

function makeSheet(cells: Record<string, string>): Sheet {
  return {
    id: 's1',
    name: 'Sheet1',
    rowCount: 10,
    columnCount: 6,
    cells,
    filterViews: [],
    validationRules: [],
  };
}

describe('sortKeyOf', () => {
  it('classifies numbers, parseable dates and text by their types', () => {
    expect(sortKeyOf('1200')).toEqual({ kind: 'number', value: 1200 });
    expect(sortKeyOf(' 800 ')).toEqual({ kind: 'number', value: 800 });
    expect(sortKeyOf('2026-01-05')).toEqual({ kind: 'number', value: Date.parse('2026-01-05') });
    expect(sortKeyOf('East')).toEqual({ kind: 'text', value: 'East' });
    expect(sortKeyOf('')).toEqual({ kind: 'empty' });
    expect(sortKeyOf('   ')).toEqual({ kind: 'empty' });
  });
});

describe('compareSortKeys', () => {
  it('compares numbers numerically in both orders', () => {
    const a = sortKeyOf('1200');
    const b = sortKeyOf('800');
    expect(compareSortKeys(a, b, 'ascending')).toBeGreaterThan(0);
    expect(compareSortKeys(a, b, 'descending')).toBeLessThan(0);
  });

  it('compares text lexically and puts numbers before text', () => {
    const east = sortKeyOf('East');
    const north = sortKeyOf('North');
    expect(compareSortKeys(east, north, 'ascending')).toBeLessThan(0);
    expect(compareSortKeys(east, north, 'descending')).toBeGreaterThan(0);
    expect(compareSortKeys(sortKeyOf('800'), sortKeyOf('Open'), 'ascending')).toBeLessThan(0);
    expect(compareSortKeys(sortKeyOf('800'), sortKeyOf('Open'), 'descending')).toBeLessThan(0);
  });

  it('sorts empty cells last in both orders', () => {
    const empty = sortKeyOf('');
    const text = sortKeyOf('East');
    expect(compareSortKeys(empty, text, 'ascending')).toBeGreaterThan(0);
    expect(compareSortKeys(empty, text, 'descending')).toBeGreaterThan(0);
    expect(compareSortKeys(text, empty, 'ascending')).toBeLessThan(0);
    expect(compareSortKeys(text, empty, 'descending')).toBeLessThan(0);
  });
});

describe('sortSheetRange', () => {
  // The REQ-5-1-1 evaluation seed: range A1:C6, headers Region/Sales/Status,
  // rows East/1200/Open, North/800/Closed, South/700/Open (rows 5-6 empty).
  function seed(): Sheet {
    return makeSheet({
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
      D2: 'outside',
    });
  }

  it('sorts a range by a numeric column ascending with a header row', () => {
    const outcome = sortSheetRange(seed(), 'A1:C6', {
      column: 1,
      order: 'ascending',
      hasHeader: true,
    });
    expect('error' in outcome).toBe(false);
    const sheet = outcome as { sheet: Sheet };
    const cells = sheet.sheet.cells;
    expect(cells.A1).toBe('Region'); // header stays
    expect(cells.B1).toBe('Sales');
    expect(cells.C1).toBe('Status');
    expect(cells.A2).toBe('South');
    expect(cells.B2).toBe('700');
    expect(cells.C2).toBe('Open');
    expect(cells.A3).toBe('North');
    expect(cells.B3).toBe('800');
    expect(cells.C3).toBe('Closed');
    expect(cells.A4).toBe('East');
    expect(cells.B4).toBe('1200');
    expect(cells.C4).toBe('Open');
    // Empty rows stay at the bottom
    expect(cells.A5).toBeUndefined();
    expect(cells.A6).toBeUndefined();
    // Cells outside the range are untouched
    expect(cells.D2).toBe('outside');
  });

  it('sorts descending by the numeric column', () => {
    const outcome = sortSheetRange(seed(), 'A1:C6', {
      column: 1,
      order: 'descending',
      hasHeader: true,
    });
    expect('error' in outcome).toBe(false);
    const cells = (outcome as { sheet: Sheet }).sheet.cells;
    expect(cells.A2).toBe('East');
    expect(cells.B2).toBe('1200');
    expect(cells.A3).toBe('North');
    expect(cells.B3).toBe('800');
    expect(cells.A4).toBe('South');
    expect(cells.B4).toBe('700');
    expect(cells.A1).toBe('Region');
  });

  it('sorts text values lexically', () => {
    const outcome = sortSheetRange(seed(), 'A1:C6', {
      column: 0,
      order: 'ascending',
      hasHeader: true,
    });
    expect('error' in outcome).toBe(false);
    const cells = (outcome as { sheet: Sheet }).sheet.cells;
    expect(cells.A2).toBe('East');
    expect(cells.A3).toBe('North');
    expect(cells.A4).toBe('South');
    const desc = sortSheetRange(seed(), 'A1:C6', {
      column: 0,
      order: 'descending',
      hasHeader: true,
    });
    const descCells = (desc as { sheet: Sheet }).sheet.cells;
    expect(descCells.A2).toBe('South');
    expect(descCells.A3).toBe('North');
    expect(descCells.A4).toBe('East');
  });

  it('keeps equal sort keys in their original relative order (stable)', () => {
    const sheet = makeSheet({
      A1: 'Region',
      B1: 'Sales',
      A2: 'East',
      B2: '100',
      A3: 'North',
      B3: '100',
      A4: 'South',
      B4: '100',
    });
    const outcome = sortSheetRange(sheet, 'A1:C6', {
      column: 1,
      order: 'ascending',
      hasHeader: true,
    });
    expect('error' in outcome).toBe(false);
    const cells = (outcome as { sheet: Sheet }).sheet.cells;
    expect(cells.A2).toBe('East');
    expect(cells.A3).toBe('North');
    expect(cells.A4).toBe('South');
  });

  it('moves the header row too when hasHeader is false', () => {
    const outcome = sortSheetRange(seed(), 'A1:C6', {
      column: 1,
      order: 'ascending',
      hasHeader: false,
    });
    expect('error' in outcome).toBe(false);
    const cells = (outcome as { sheet: Sheet }).sheet.cells;
    // The sorted records start at row 1: numeric values first, then the
    // header record (text "Sales") participates and sorts after them
    expect(cells.A1).toBe('South');
    expect(cells.B1).toBe('700');
    expect(cells.A2).toBe('North');
    expect(cells.B2).toBe('800');
    expect(cells.A3).toBe('East');
    expect(cells.B3).toBe('1200');
    expect(cells.A4).toBe('Region');
    expect(cells.B4).toBe('Sales');
  });

  it('compares parseable dates chronologically', () => {
    const sheet = makeSheet({
      A1: 'Date',
      A2: '2026-03-01',
      A3: '2026-01-15',
      A4: '2025-12-31',
    });
    const outcome = sortSheetRange(sheet, 'A1:A6', {
      column: 0,
      order: 'ascending',
      hasHeader: true,
    });
    expect('error' in outcome).toBe(false);
    const cells = (outcome as { sheet: Sheet }).sheet.cells;
    expect(cells.A2).toBe('2025-12-31');
    expect(cells.A3).toBe('2026-01-15');
    expect(cells.A4).toBe('2026-03-01');
  });

  it('reports an error for an invalid range or an out-of-range column', () => {
    const sheet = seed();
    const badRange = sortSheetRange(sheet, 'not-a-range', {
      column: 0,
      order: 'ascending',
      hasHeader: true,
    });
    expect('error' in badRange).toBe(true);
    const badColumn = sortSheetRange(sheet, 'A1:C6', {
      column: 3,
      order: 'ascending',
      hasHeader: true,
    });
    expect('error' in badColumn).toBe(true);
    expect(badColumn).toEqual({ error: 'Sort column is outside the selected range' });
  });

  it('leaves the sheet unchanged when the range has no data rows', () => {
    const sheet = seed();
    const outcome = sortSheetRange(sheet, 'A1:A1', {
      column: 0,
      order: 'ascending',
      hasHeader: true,
    });
    expect('error' in outcome).toBe(false);
    expect((outcome as { sheet: Sheet }).sheet.cells).toEqual(sheet.cells);
  });
});

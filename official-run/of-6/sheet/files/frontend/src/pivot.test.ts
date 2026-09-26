import { describe, expect, it } from 'vitest';
import type { Sheet } from './types';
import {
  computePivot,
  headerTextsInRange,
  nextPivotName,
  parseableNumber,
  PIVOT_FIELD_MISSING,
  PIVOT_NUMERIC_ERROR,
} from './pivot';

// The REQ-5-3-1 evaluation seed: seeded worksheet range A1:C6 with headers
// Region/Sales/Status and rows East/1200/Open, North/800/Closed,
// South/700/Open.
function pivotSeedSheet(): Sheet {
  return {
    id: 'sheet1',
    name: 'Sheet1',
    rowCount: 6,
    columnCount: 3,
    cells: {
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
    },
    filterViews: [],
    validationRules: [],
  };
}

describe('nextPivotName', () => {
  it('uses the first unused PivotN name in positive-integer order', () => {
    expect(nextPivotName([])).toBe('Pivot1');
    expect(nextPivotName(['Sheet1', 'Sheet2'])).toBe('Pivot1');
    expect(nextPivotName(['Pivot1', 'Pivot3', 'Sheet1'])).toBe('Pivot2');
    expect(nextPivotName(['Pivot1', 'Pivot2'])).toBe('Pivot3');
    expect(nextPivotName(['Pivot1', '  Pivot2  '])).toBe('Pivot3');
  });
});

describe('parseableNumber', () => {
  it('parses decimal literals and rejects text/empty values', () => {
    expect(parseableNumber('1200')).toBe(1200);
    expect(parseableNumber(' 800 ')).toBe(800);
    expect(parseableNumber('12.5')).toBe(12.5);
    expect(parseableNumber('.5')).toBe(0.5);
    expect(parseableNumber('-3')).toBe(-3);
    expect(parseableNumber('Open')).toBeNull();
    expect(parseableNumber('')).toBeNull();
    expect(parseableNumber('1,200')).toBeNull();
  });
});

describe('headerTextsInRange', () => {
  it('returns the header texts of the range first row', () => {
    expect(headerTextsInRange(pivotSeedSheet(), 'A1:C6')).toEqual([
      'Region',
      'Sales',
      'Status',
    ]);
    expect(headerTextsInRange(pivotSeedSheet(), 'A1:A6')).toEqual(['Region']);
  });
});

describe('computePivot without a column field', () => {
  const config = { rowField: 'Region', valueField: 'Sales', summarizeBy: 'SUM' as const };

  it('A1 shows the row-field name and B1 shows "<method> of <value field>"', () => {
    const outcome = computePivot(pivotSeedSheet(), 'A1:C6', config);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.cells.A1).toBe('Region');
    expect(outcome.cells.B1).toBe('SUM of Sales');
    expect(outcome.cells.A2).toBe('East');
    expect(outcome.cells.B2).toBe('1200');
    expect(outcome.cells.A3).toBe('North');
    expect(outcome.cells.B3).toBe('800');
    expect(outcome.cells.A4).toBe('South');
    expect(outcome.cells.B4).toBe('700');
    expect(outcome.cells.A5).toBe('Grand Total');
    expect(outcome.cells.B5).toBe('2700');
    expect(outcome.maxRow).toBe(4);
    expect(outcome.maxCol).toBe(1);
  });

  it('COUNT counts non-empty records and ignores nonnumeric content', () => {
    const count = computePivot(pivotSeedSheet(), 'A1:C6', {
      rowField: 'Region',
      valueField: 'Sales',
      summarizeBy: 'COUNT',
    });
    expect(count.ok).toBe(true);
    if (!count.ok) {
      return;
    }
    expect(count.cells.B1).toBe('COUNT of Sales');
    expect(count.cells.B2).toBe('1');
    expect(count.cells.B3).toBe('1');
    expect(count.cells.B4).toBe('1');
    expect(count.cells.B5).toBe('3');

    // Nonnumeric values still count as non-empty records.
    const sheet = pivotSeedSheet();
    sheet.cells.B2 = 'Open';
    const countMixed = computePivot(sheet, 'A1:C6', {
      rowField: 'Region',
      valueField: 'Sales',
      summarizeBy: 'COUNT',
    });
    expect(countMixed.ok).toBe(true);
    if (!countMixed.ok) {
      return;
    }
    expect(countMixed.cells.B2).toBe('1');
    expect(countMixed.cells.B5).toBe('3');
  });

  it('AVERAGE aggregates parseable numbers and uses a whole-field average for the Grand Total', () => {
    const avg = computePivot(pivotSeedSheet(), 'A1:C6', {
      rowField: 'Region',
      valueField: 'Sales',
      summarizeBy: 'AVERAGE',
    });
    expect(avg.ok).toBe(true);
    if (!avg.ok) {
      return;
    }
    expect(avg.cells.B1).toBe('AVERAGE of Sales');
    expect(avg.cells.B2).toBe('1200');
    expect(avg.cells.B3).toBe('800');
    expect(avg.cells.B4).toBe('700');
    expect(avg.cells.B5).toBe('900');
  });

  it('SUM/AVERAGE skip non-parseable entries within the value field', () => {
    const sheet = pivotSeedSheet();
    sheet.cells.B2 = 'Open'; // East's value is not a number
    const sum = computePivot(sheet, 'A1:C6', {
      rowField: 'Region',
      valueField: 'Sales',
      summarizeBy: 'SUM',
    });
    expect(sum.ok).toBe(true);
    if (!sum.ok) {
      return;
    }
    expect(sum.cells.B2).toBe('');
    expect(sum.cells.B5).toBe('1500'); // only North + South
    const avg = computePivot(sheet, 'A1:C6', {
      rowField: 'Region',
      valueField: 'Sales',
      summarizeBy: 'AVERAGE',
    });
    expect(avg.ok).toBe(true);
    if (!avg.ok) {
      return;
    }
    expect(avg.cells.B5).toBe('750');
  });
});

describe('computePivot with a column field', () => {
  it('arranges column-field values from B1 onward by first appearance with a final Grand Total column', () => {
    const outcome = computePivot(pivotSeedSheet(), 'A1:C6', {
      rowField: 'Region',
      columnField: 'Status',
      valueField: 'Sales',
      summarizeBy: 'SUM',
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.cells.A1).toBe('Region');
    expect(outcome.cells.B1).toBe('Open');
    expect(outcome.cells.C1).toBe('Closed');
    expect(outcome.cells.D1).toBe('Grand Total');
    expect(outcome.cells.A2).toBe('East');
    expect(outcome.cells.B2).toBe('1200'); // East/Open
    expect(outcome.cells.C2).toBe(''); // East/Closed has no record
    expect(outcome.cells.D2).toBe('1200');
    expect(outcome.cells.A3).toBe('North');
    expect(outcome.cells.B3).toBe('');
    expect(outcome.cells.C3).toBe('800');
    expect(outcome.cells.D3).toBe('800');
    expect(outcome.cells.A4).toBe('South');
    expect(outcome.cells.B4).toBe('700');
    expect(outcome.cells.C4).toBe('');
    expect(outcome.cells.D4).toBe('700');
    expect(outcome.cells.A5).toBe('Grand Total');
    expect(outcome.cells.B5).toBe('1900');
    expect(outcome.cells.C5).toBe('800');
    expect(outcome.cells.D5).toBe('2700');
    expect(outcome.maxRow).toBe(4);
    expect(outcome.maxCol).toBe(3);
  });

  it('COUNT displays 0 when a row/column combination has no record with a non-empty value field', () => {
    const outcome = computePivot(pivotSeedSheet(), 'A1:C6', {
      rowField: 'Region',
      columnField: 'Status',
      valueField: 'Sales',
      summarizeBy: 'COUNT',
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.cells.B2).toBe('1'); // East/Open
    expect(outcome.cells.C2).toBe('0'); // East/Closed: no record
    expect(outcome.cells.B3).toBe('0'); // North/Open: no record
    expect(outcome.cells.C3).toBe('1'); // North/Closed
    expect(outcome.cells.D2).toBe('1');
    expect(outcome.cells.D5).toBe('3');
    expect(outcome.cells.B5).toBe('2');
    expect(outcome.cells.C5).toBe('1');
  });
});

describe('computePivot errors', () => {
  it('rejects a value field without parseable numbers for SUM/AVERAGE and allows COUNT', () => {
    const sheet = pivotSeedSheet();
    sheet.cells.B2 = 'Open';
    sheet.cells.B3 = 'Closed';
    sheet.cells.B4 = 'Open';
    const sum = computePivot(sheet, 'A1:C6', {
      rowField: 'Region',
      valueField: 'Sales',
      summarizeBy: 'SUM',
    });
    expect(sum).toEqual({ ok: false, error: PIVOT_NUMERIC_ERROR });
    const avg = computePivot(sheet, 'A1:C6', {
      rowField: 'Region',
      valueField: 'Sales',
      summarizeBy: 'AVERAGE',
    });
    expect(avg).toEqual({ ok: false, error: PIVOT_NUMERIC_ERROR });
    const count = computePivot(sheet, 'A1:C6', {
      rowField: 'Region',
      valueField: 'Sales',
      summarizeBy: 'COUNT',
    });
    expect(count.ok).toBe(true);
  });

  it('reports a missing field with the required message', () => {
    const sheet = pivotSeedSheet();
    delete sheet.cells.C1; // Status header removed
    const outcome = computePivot(sheet, 'A1:C6', {
      rowField: 'Region',
      columnField: 'Status',
      valueField: 'Sales',
      summarizeBy: 'SUM',
    });
    expect(outcome).toEqual({ ok: false, error: PIVOT_FIELD_MISSING });
    const rowMissing = computePivot(sheet, 'A1:C6', {
      rowField: 'Region',
      valueField: 'Sales',
      summarizeBy: 'SUM',
    });
    expect(rowMissing.ok).toBe(true);
  });

  it('rejects an invalid range', () => {
    const outcome = computePivot(pivotSeedSheet(), 'garbage', {
      rowField: 'Region',
      valueField: 'Sales',
      summarizeBy: 'SUM',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBe('Invalid source range');
    }
  });
});

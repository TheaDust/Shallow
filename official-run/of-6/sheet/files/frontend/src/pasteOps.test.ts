import { describe, expect, it } from 'vitest';
import { applyClipboardPasteToSheet, applyPasteToSheet, parsePasteText } from './pasteOps';
import type { Sheet } from './types';

function makeSheet(overrides: Partial<Sheet> = {}): Sheet {
  return {
    id: 'sheet1',
    name: 'Sheet1',
    rowCount: 20,
    columnCount: 6,
    cells: { A1: 'Item', B1: 'Qty', A2: 'Pen', B2: '4' },
    filterViews: [],
    validationRules: [],
    ...overrides,
  };
}

describe('parsePasteText', () => {
  it('splits tab-separated columns and newline-separated rows', () => {
    expect(parsePasteText('East\t1200\nNorth\t800')).toEqual([
      ['East', '1200'],
      ['North', '800'],
    ]);
  });

  it('preserves empty fields inside rows and trailing empty columns', () => {
    expect(parsePasteText('a\t\tb\t')).toEqual([['a', '', 'b', '']]);
  });

  it('handles \\r\\n and \\r line endings', () => {
    expect(parsePasteText('a\tb\r\nc\td\re\tf')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ]);
  });

  it('drops trailing empty rows but keeps empty rows in the middle', () => {
    expect(parsePasteText('a\tb\n\nc\td\n')).toEqual([
      ['a', 'b'],
      [''],
      ['c', 'd'],
    ]);
  });

  it('returns an empty grid for an empty string', () => {
    expect(parsePasteText('')).toEqual([]);
  });
});

describe('applyPasteToSheet', () => {
  it('pastes the whole rectangle at the starting cell and leaves the rest untouched', () => {
    const sheet = makeSheet();
    const result = applyPasteToSheet(sheet, 'D1', 'East\t1200\nNorth\t800');
    expect(result.error).toBeNull();
    expect(result.cells).toEqual({
      A1: 'Item',
      B1: 'Qty',
      A2: 'Pen',
      B2: '4',
      D1: 'East',
      E1: '1200',
      D2: 'North',
      E2: '800',
    });
  });

  it('overwrites only the target rectangle (existing values inside are replaced, outside kept)', () => {
    const sheet = makeSheet({
      cells: { A1: 'Item', B1: 'Qty', A2: 'Pen', B2: '4', D1: 'old', E2: 'keep' },
    });
    const result = applyPasteToSheet(sheet, 'D1', 'East\t1200\nNorth\t800');
    expect(result.error).toBeNull();
    expect(result.cells.D1).toBe('East');
    expect(result.cells.E1).toBe('1200');
    expect(result.cells.D2).toBe('North');
    expect(result.cells.E2).toBe('800');
    expect(result.cells.E2).not.toBe('keep'); // inside the rectangle: replaced
    expect(result.cells.A1).toBe('Item');
  });

  it('preserves empty fields by clearing the target cells', () => {
    const sheet = makeSheet({ cells: { D1: 'x', E1: 'y', D2: 'z', E2: 'w' } });
    const result = applyPasteToSheet(sheet, 'D1', 'a\t\tb');
    expect(result.error).toBeNull();
    expect(result.cells.D1).toBe('a');
    expect(result.cells.E1).toBeUndefined();
    expect(result.cells.F1).toBe('b');
    expect(result.cells.D2).toBe('z'); // outside the 1x3 rectangle
  });

  it('replaces formulas inside the target with the pasted content', () => {
    const sheet = makeSheet({ cells: { D1: '=5*2' } });
    const result = applyPasteToSheet(sheet, 'D1', 'East');
    expect(result.error).toBeNull();
    expect(result.cells.D1).toBe('East');
    expect(result.cells).not.toHaveProperty('D1', '=5*2');
  });

  it('stores pasted formulas starting with an equals sign', () => {
    const sheet = makeSheet();
    const result = applyPasteToSheet(sheet, 'D1', '=B2*2');
    expect(result.error).toBeNull();
    expect(result.cells.D1).toBe('=B2*2');
  });

  it('rejects the whole paste when a 0-to-100 numeric rule rejects any cell', () => {
    const sheet = makeSheet({
      validationRules: [
        { id: 'vr1', range: 'D1:E2', type: 'number', min: 0, max: 100 },
      ],
    });
    const original = sheet.cells;
    const result = applyPasteToSheet(sheet, 'D1', 'East\t1200\nNorth\t800');
    expect(result.error).toBe('Please enter a number from 0 to 100');
    expect(result.cells).toBe(original); // no partial record
  });

  it('accepts a paste when every value satisfies the rule', () => {
    const sheet = makeSheet({
      validationRules: [
        { id: 'vr1', range: 'D1:E2', type: 'number', min: 0, max: 100 },
      ],
    });
    const result = applyPasteToSheet(sheet, 'D1', '50\t60\n70\t80');
    expect(result.error).toBeNull();
    expect(result.cells.D1).toBe('50');
    expect(result.cells.E1).toBe('60');
    expect(result.cells.D2).toBe('70');
    expect(result.cells.E2).toBe('80');
  });

  it('rejects a paste that exceeds the worksheet bounds without partial writes', () => {
    const sheet = makeSheet({ rowCount: 2, columnCount: 2 });
    const original = sheet.cells;
    const result = applyPasteToSheet(sheet, 'B2', 'a\tb\nc\td');
    expect(result.error).toBe('Paste area exceeds the worksheet bounds');
    expect(result.cells).toBe(original);
  });

  it('is a no-op for empty clipboard text', () => {
    const sheet = makeSheet();
    const result = applyPasteToSheet(sheet, 'D1', '');
    expect(result.error).toBeNull();
    expect(result.cells).toBe(sheet.cells);
  });

  it('pastes a single value into the starting cell', () => {
    const sheet = makeSheet();
    const result = applyPasteToSheet(sheet, 'D1', 'East');
    expect(result.error).toBeNull();
    expect(result.cells.D1).toBe('East');
  });
});

describe('applyClipboardPasteToSheet', () => {
  const copyClipboard = (rows: string[][], anchor = 'A1', active = 'B2') => ({
    sheetId: 'sheet1',
    kind: 'copy' as const,
    anchor,
    active,
    rows,
  });

  it('pastes a copied rectangle with formulas translated by the target offset', () => {
    const sheet = makeSheet({ cells: { A1: '=B2+1', B1: 'Qty', A2: 'Pen', B2: '4' } });
    const result = applyClipboardPasteToSheet(sheet, 'D1', copyClipboard([
      ['=B2+1', 'Qty'],
      ['Pen', '4'],
    ]));
    expect(result.error).toBeNull();
    expect(result.cells.D1).toBe('=E2+1');
    expect(result.cells.E1).toBe('Qty');
    expect(result.cells.D2).toBe('Pen');
    expect(result.cells.E2).toBe('4');
    // the copied source range remains unchanged
    expect(result.cells.A1).toBe('=B2+1');
  });

  it('keeps absolute references unchanged when copying formulas', () => {
    const sheet = makeSheet({ cells: { A1: '=$B$2+1' } });
    const result = applyClipboardPasteToSheet(sheet, 'D1', copyClipboard([['=$B$2+1']]));
    expect(result.error).toBeNull();
    expect(result.cells.D1).toBe('=$B$2+1');
  });

  it('turns a copied formula reference that moves past the right/bottom edge into #REF!', () => {
    // 6-column, 20-row sheet: E2 -> F2 shifts F1 to G1 (off-grid) and a
    // bottom-edge reference past row 20 becomes #REF! too.
    const right = makeSheet({ cells: { E2: '=F1*2' } });
    const rightResult = applyClipboardPasteToSheet(right, 'F2', copyClipboard([['=F1*2']], 'E2', 'E2'));
    expect(rightResult.error).toBeNull();
    expect(rightResult.cells.F2).toBe('=#REF!*2');

    const bottom = makeSheet({ cells: { E2: '=A20*2' } });
    const bottomResult = applyClipboardPasteToSheet(bottom, 'E3', copyClipboard([['=A20*2']], 'E2', 'E2'));
    expect(bottomResult.error).toBeNull();
    expect(bottomResult.cells.E3).toBe('=#REF!*2');

    // a reference that stays inside the bounds is translated normally
    const inside = makeSheet({ cells: { E2: '=E1*2' } });
    const insideResult = applyClipboardPasteToSheet(inside, 'F2', copyClipboard([['=E1*2']], 'E2', 'E2'));
    expect(insideResult.error).toBeNull();
    expect(insideResult.cells.F2).toBe('=F1*2');
  });

  it('turns a copied formula reference moved above/left of the grid into #REF!', () => {
    const sheet = makeSheet({ cells: { A1: '2', B1: '3', C1: '=A1+B1', D1: '=C1*2' } });
    const result = applyClipboardPasteToSheet(sheet, 'A1', copyClipboard([['=C1*2']], 'D1', 'D1'));
    expect(result.error).toBeNull();
    expect(result.cells.A1).toBe('=#REF!*2');
  });

  it('cut paste clears the source rectangle and moves formulas without rewriting them', () => {
    const sheet = makeSheet({ cells: { A1: '=B2+1', B1: 'Qty', A2: 'Pen', B2: '4' } });
    const result = applyClipboardPasteToSheet(sheet, 'D1', {
      sheetId: 'sheet1',
      kind: 'cut',
      anchor: 'A1',
      active: 'B2',
      rows: [
        ['=B2+1', 'Qty'],
        ['Pen', '4'],
      ],
    });
    expect(result.error).toBeNull();
    expect(result.cells.A1).toBeUndefined();
    expect(result.cells.B1).toBeUndefined();
    expect(result.cells.A2).toBeUndefined();
    expect(result.cells.B2).toBeUndefined();
    expect(result.cells.D1).toBe('=B2+1');
    expect(result.cells.E1).toBe('Qty');
    expect(result.cells.D2).toBe('Pen');
    expect(result.cells.E2).toBe('4');
  });

  it('cut paste with an overlapping target moves the values (source read before clear)', () => {
    const sheet = makeSheet(); // A1=Item B1=Qty A2=Pen B2=4
    const result = applyClipboardPasteToSheet(sheet, 'B1', {
      sheetId: 'sheet1',
      kind: 'cut',
      anchor: 'A1',
      active: 'B2',
      rows: [
        ['Item', 'Qty'],
        ['Pen', '4'],
      ],
    });
    expect(result.error).toBeNull();
    // target B1:C2 receives the source values, source A1:B2 is cleared
    expect(result.cells.B1).toBe('Item');
    expect(result.cells.C1).toBe('Qty');
    expect(result.cells.B2).toBe('Pen');
    expect(result.cells.C2).toBe('4');
    expect(result.cells.A1).toBeUndefined();
    expect(result.cells.A2).toBeUndefined();
  });

  it('rejects a copy paste rejected by a 0-to-100 rule and keeps every cell unchanged', () => {
    const sheet = makeSheet({
      validationRules: [
        { id: 'vr1', range: 'D1:E2', type: 'number', min: 0, max: 100 },
      ],
    });
    const result = applyClipboardPasteToSheet(sheet, 'D1', copyClipboard([
      ['Item', 'Qty'],
      ['Pen', '4'],
    ]));
    expect(result.error).toBe('Please enter a number from 0 to 100');
    expect(result.cells).toBe(sheet.cells);
  });

  it('cut paste rejected by validation leaves the source rectangle intact', () => {
    const sheet = makeSheet({
      validationRules: [
        { id: 'vr1', range: 'D1:E2', type: 'number', min: 0, max: 100 },
      ],
    });
    const original = sheet.cells;
    const result = applyClipboardPasteToSheet(sheet, 'D1', {
      sheetId: 'sheet1',
      kind: 'cut',
      anchor: 'A1',
      active: 'B2',
      rows: [
        ['Item', 'Qty'],
        ['Pen', '4'],
      ],
    });
    expect(result.error).toBe('Please enter a number from 0 to 100');
    expect(result.cells).toBe(original);
  });

  it('a copy paste that satisfies the rule commits the whole rectangle', () => {
    const sheet = makeSheet({
      cells: { A1: '50', B1: '60', A2: '70', B2: '80' },
      validationRules: [
        { id: 'vr1', range: 'D1:E2', type: 'number', min: 0, max: 100 },
      ],
    });
    const result = applyClipboardPasteToSheet(sheet, 'D1', copyClipboard([
      ['50', '60'],
      ['70', '80'],
    ]));
    expect(result.error).toBeNull();
    expect(result.cells.D1).toBe('50');
    expect(result.cells.E1).toBe('60');
    expect(result.cells.D2).toBe('70');
    expect(result.cells.E2).toBe('80');
    // the source range keeps its unchanged original values for a copy
    expect(result.cells.A1).toBe('50');
    expect(result.cells.B1).toBe('60');
    expect(result.cells.A2).toBe('70');
    expect(result.cells.B2).toBe('80');
  });

  it('rejects a clipboard paste that exceeds the worksheet bounds', () => {
    const sheet = makeSheet({ rowCount: 2, columnCount: 2 });
    const original = sheet.cells;
    const result = applyClipboardPasteToSheet(sheet, 'B2', copyClipboard([
      ['a', 'b'],
      ['c', 'd'],
    ]));
    expect(result.error).toBe('Paste area exceeds the worksheet bounds');
    expect(result.cells).toBe(original);
  });
});

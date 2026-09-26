import { describe, expect, it } from 'vitest';
import { escapeCsvField, cellExportValue, sheetToCsv } from './csvExport';
import { evaluateFormula, formatFormulaValue } from './formula';
import type { Sheet } from './types';

function makeSheet(cells: Record<string, string>, rowCount = 4, columnCount = 4): Sheet {
  return {
    id: 'sheet1',
    name: 'Sheet1',
    rowCount,
    columnCount,
    cells,
    filterViews: [],
    validationRules: [],
  };
}

describe('escapeCsvField', () => {
  it('leaves plain fields unchanged', () => {
    expect(escapeCsvField('Region')).toBe('Region');
    expect(escapeCsvField('1200')).toBe('1200');
    expect(escapeCsvField('')).toBe('');
  });

  it('quotes fields containing commas', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
  });

  it('quotes fields containing double quotes and escapes them as ""', () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it('quotes fields containing line breaks', () => {
    expect(escapeCsvField('first\nsecond')).toBe('"first\nsecond"');
    expect(escapeCsvField('first\r\nsecond')).toBe('"first\r\nsecond"');
  });
});

describe('cellExportValue', () => {
  it('exports ordinary cells as their displayed value', () => {
    const sheet = makeSheet({ A1: 'Region', B2: '1200' });
    expect(cellExportValue('Region', sheet)).toBe('Region');
    expect(cellExportValue('1200', sheet)).toBe('1200');
  });

  it('exports formula cells as calculated results', () => {
    const sheet = makeSheet({ A1: 'Region', A2: '1200', B2: '=A2*2', C2: '=1+2' });
    expect(cellExportValue('=1+2', sheet)).toBe('3');
    expect(cellExportValue('=A2*2', sheet)).toBe('2400');
    expect(cellExportValue('=SUM(A2:C2)', sheet)).toBe('3603');
  });

  it('exports error formulas as their stable error token', () => {
    const sheet = makeSheet({ A1: '=1/0', B1: '=FOO(1)', C1: '=1+', D1: 'abc' });
    expect(cellExportValue('=1/0', sheet)).toBe('#DIV/0!');
    expect(cellExportValue('=FOO(1)', sheet)).toBe('#NAME?');
    expect(cellExportValue('=1+', sheet)).toBe('#ERROR!');
    expect(cellExportValue('=D1+1', sheet)).toBe('#ERROR!');
  });
});

describe('sheetToCsv', () => {
  it('preserves empty cells within the used range and the grid order', () => {
    const sheet = makeSheet({ A1: 'Region', C1: 'Value' });
    expect(sheetToCsv(sheet)).toBe('Region,,Value,\n,,,\n,,,\n,,,');
  });

  it('round-trips rows and columns in original order', () => {
    const sheet = makeSheet(
      { A1: 'Region', B1: 'East', A2: 'North', B2: '1200', A3: '800' },
      3,
      2
    );
    expect(sheetToCsv(sheet)).toBe('Region,East\nNorth,1200\n800,');
  });

  it('escapes commas, quotes and line breaks in exported fields', () => {
    const sheet = makeSheet(
      { A1: 'a,b', A2: 'say "hi"', A3: 'first\nsecond', B1: 'x' },
      3,
      2
    );
    expect(sheetToCsv(sheet)).toBe('"a,b",x\n"say ""hi""",\n"first\nsecond",');
  });

  it('exports formula cells as results inside the full sheet', () => {
    const sheet = makeSheet(
      { A1: 'Item', B1: 'Qty', A2: 'Pen', B2: '4', A3: '=SUM(B2)', A4: '=B2*2' },
      4,
      2
    );
    const csv = sheetToCsv(sheet);
    expect(csv).toBe('Item,Qty\nPen,4\n4,\n8,');
  });
});

describe('evaluateFormula', () => {
  it('evaluates arithmetic with precedence, parentheses, unary minus and exponent', () => {
    expect(evaluateFormula('=1+2*3', {})).toBe(7);
    expect(evaluateFormula('=(1+2)*3', {})).toBe(9);
    expect(evaluateFormula('=-5+3', {})).toBe(-2);
    expect(evaluateFormula('=2^3', {})).toBe(8);
    expect(evaluateFormula('=10/4', {})).toBe(2.5);
  });

  it('resolves cell references, numbers and text', () => {
    expect(evaluateFormula('=A1*2', { A1: '1200' })).toBe(2400);
    expect(evaluateFormula('=A1', { A1: 'Region' })).toBe('Region');
    expect(evaluateFormula('=A1+1', { A1: 'East' })).toBe('#ERROR!');
  });

  it('evaluates SUM over ranges and cell lists, ignoring text in ranges', () => {
    expect(evaluateFormula('=SUM(A1:B2)', { A1: '1', B1: '2', A2: '3', B2: '4' })).toBe(10);
    expect(evaluateFormula('=SUM(A1:B1,A3)', { A1: '1', B1: '2', A3: '5' })).toBe(8);
    expect(evaluateFormula('=SUM(A1:B2)', { A1: 'East', B1: '2', A2: '3', B2: '4' })).toBe(9);
  });

  it('returns a stable error token for unparseable formulas and empty text for blank formulas', () => {
    expect(evaluateFormula('=1+', {})).toBe('#ERROR!');
    expect(evaluateFormula('', {})).toBe('');
  });
});

describe('formatFormulaValue', () => {
  it('formats numbers and text for export', () => {
    expect(formatFormulaValue(3)).toBe('3');
    expect(formatFormulaValue(2.5)).toBe('2.5');
    expect(formatFormulaValue('Region')).toBe('Region');
  });
});

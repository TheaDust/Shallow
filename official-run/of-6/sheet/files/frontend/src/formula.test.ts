import { describe, expect, it } from 'vitest';
import { evaluateFormula, formatFormulaValue, translateFormulaRefs } from './formula';

describe('translateFormulaRefs', () => {
  it('shifts relative references by the paste offset', () => {
    expect(translateFormulaRefs('=A1+B2', 0, 3)).toBe('=D1+E2');
    expect(translateFormulaRefs('=A1+B2', 2, 1)).toBe('=B3+C4');
  });

  it('keeps absolute references unchanged while shifting relative ones', () => {
    expect(translateFormulaRefs('=$A$1+B2', 0, 3)).toBe('=$A$1+E2');
    expect(translateFormulaRefs('=$A1+B$2', 2, 3)).toBe('=$A3+E$2');
  });

  it('translates references inside SUM ranges and argument lists', () => {
    expect(translateFormulaRefs('=SUM(A1:B2)*C3', 0, 3)).toBe('=SUM(D1:E2)*F3');
    expect(translateFormulaRefs('=SUM(A1,B2)', 1, 1)).toBe('=SUM(B2,C3)');
  });

  it('returns the formula unchanged when the offset is zero', () => {
    const formula = '=A1+$B$2';
    expect(translateFormulaRefs(formula, 0, 0)).toBe(formula);
  });

  it('produces #REF! when a relative reference would move off the grid', () => {
    expect(translateFormulaRefs('=B1', 0, -2)).toBe('=#REF!');
    expect(translateFormulaRefs('=A2', -2, 0)).toBe('=#REF!');
    // absolute references never move off the grid
    expect(translateFormulaRefs('=$A$1', 0, -5)).toBe('=$A$1');
  });

  it('flags references that would move beyond the sheet bounds as #REF!', () => {
    const bounds = { rowCount: 20, columnCount: 6 };
    expect(translateFormulaRefs('=F1*2', 0, 1, bounds)).toBe('=#REF!*2');
    expect(translateFormulaRefs('=A20*2', 1, 0, bounds)).toBe('=#REF!*2');
    // references that stay inside the bounds are translated normally
    expect(translateFormulaRefs('=E1+B1', 0, 1, bounds)).toBe('=F1+C1');
    expect(translateFormulaRefs('=A19+B1', 1, 0, bounds)).toBe('=A20+B2');
    // a reference crossing the bottom edge becomes #REF! while another stays
    expect(translateFormulaRefs('=A19+B20', 1, 0, bounds)).toBe('=A20+#REF!');
    // absolute references stay unchanged even when the offset would be large
    expect(translateFormulaRefs('=$F$1*2', 0, 5, bounds)).toBe('=$F$1*2');
  });

  it('applies no bottom/right bound limit when bounds are not provided', () => {
    expect(translateFormulaRefs('=F1*2', 0, 5)).toBe('=K1*2');
  });

  it('does not rewrite function names or plain text', () => {
    expect(translateFormulaRefs('=SUM(1,2)', 1, 2)).toBe('=SUM(1,2)');
    expect(translateFormulaRefs('=A1+SUM(B2:C3)', 0, 1)).toBe('=B1+SUM(C2:D3)');
  });
});

describe('formula evaluation with absolute references', () => {
  it('evaluates $ references like their plain coordinates', () => {
    const cells = { B2: '4', D1: '5' };
    expect(formatFormulaValue(evaluateFormula('=$B$2+1', cells))).toBe('5');
    expect(formatFormulaValue(evaluateFormula('=B2+1', cells))).toBe('5');
    expect(formatFormulaValue(evaluateFormula('=SUM($B$2:D1)', cells))).toBe('9');
  });
});

describe('REQ-4-1-1 aggregate functions', () => {
  const cells = {
    A1: '2',
    B1: '3',
    A2: 'East',
    B2: '',
    C1: '=A1+B1',
  };

  it('supports SUM, AVERAGE, COUNT, MIN and MAX over contiguous ranges', () => {
    expect(formatFormulaValue(evaluateFormula('=SUM(A1:B2)', cells))).toBe('5');
    expect(formatFormulaValue(evaluateFormula('=AVERAGE(A1:B2)', cells))).toBe('2.5');
    expect(formatFormulaValue(evaluateFormula('=COUNT(A1:B2)', cells))).toBe('2');
    expect(formatFormulaValue(evaluateFormula('=MIN(A1:B2)', cells))).toBe('2');
    expect(formatFormulaValue(evaluateFormula('=MAX(A1:B2)', cells))).toBe('3');
  });

  it('ignores empty cells and text; SUM/AVERAGE/MIN/MAX never treat blanks as zero', () => {
    // A2 is text and B2 is empty: SUM must stay 5, not 7.
    expect(formatFormulaValue(evaluateFormula('=SUM(A1:B2)', cells))).toBe('5');
    expect(formatFormulaValue(evaluateFormula('=AVERAGE(A1:B2)', cells))).toBe('2.5');
    expect(formatFormulaValue(evaluateFormula('=MIN(A1:B2)', cells))).toBe('2');
    expect(formatFormulaValue(evaluateFormula('=MAX(A1:B2)', cells))).toBe('3');
  });

  it('COUNT counts only numeric cells', () => {
    expect(formatFormulaValue(evaluateFormula('=COUNT(A1:B2)', cells))).toBe('2');
    expect(formatFormulaValue(evaluateFormula('=COUNT(A1:A2)', cells))).toBe('1');
    expect(formatFormulaValue(evaluateFormula('=COUNT(B1:B2)', cells))).toBe('1');
    expect(formatFormulaValue(evaluateFormula('=COUNT(C1)', cells))).toBe('1');
    expect(formatFormulaValue(evaluateFormula('=COUNT(A2:B2)', cells))).toBe('0');
  });

  it('includes numeric results of formula cells in aggregates', () => {
    expect(formatFormulaValue(evaluateFormula('=SUM(A1:C1)', cells))).toBe('10');
    expect(formatFormulaValue(evaluateFormula('=AVERAGE(A1:C1)', cells))).toBe('3.3333333333333335');
    expect(formatFormulaValue(evaluateFormula('=COUNT(A1:C1)', cells))).toBe('3');
  });

  it('supports argument lists with ranges, bare cells and constants', () => {
    expect(formatFormulaValue(evaluateFormula('=SUM(4, A1:B2, 1)', cells))).toBe('10');
    expect(formatFormulaValue(evaluateFormula('=COUNT(A1, A2, B2, 7)', cells))).toBe('2');
    expect(formatFormulaValue(evaluateFormula('=MIN(9, A1, A2, B2)', cells))).toBe('2');
    expect(formatFormulaValue(evaluateFormula('=MAX(1, A2, B2, 6)', cells))).toBe('6');
    expect(formatFormulaValue(evaluateFormula('=AVERAGE(4, 6)', cells))).toBe('5');
  });

  it('handles function names case-insensitively', () => {
    expect(formatFormulaValue(evaluateFormula('=sum(A1:B2)', cells))).toBe('5');
    expect(formatFormulaValue(evaluateFormula('=Average(A1:B2)', cells))).toBe('2.5');
    expect(formatFormulaValue(evaluateFormula('=cOuNt(A1:B2)', cells))).toBe('2');
    expect(formatFormulaValue(evaluateFormula('=min(A1:B2)', cells))).toBe('2');
    expect(formatFormulaValue(evaluateFormula('=MaX(A1:B2)', cells))).toBe('3');
  });

  it('returns 0 for MIN/MAX/SUM/COUNT over ranges with no numeric cells and #DIV/0! for AVERAGE', () => {
    const empty = { A2: 'East', B2: 'text' };
    expect(formatFormulaValue(evaluateFormula('=SUM(A1:B2)', empty))).toBe('0');
    expect(formatFormulaValue(evaluateFormula('=COUNT(A1:B2)', empty))).toBe('0');
    expect(formatFormulaValue(evaluateFormula('=MIN(A1:B2)', empty))).toBe('0');
    expect(formatFormulaValue(evaluateFormula('=MAX(A1:B2)', empty))).toBe('0');
    expect(evaluateFormula('=AVERAGE(A1:B2)', empty)).toBe('#DIV/0!');
  });

  it('nests aggregates inside expressions and other aggregates', () => {
    expect(formatFormulaValue(evaluateFormula('=SUM(A1:B2)*2', cells))).toBe('10');
    expect(formatFormulaValue(evaluateFormula('=SUM(A1:B2, COUNT(A1:B2))', cells))).toBe('7');
  });
});

describe('REQ-4-1-1 arithmetic with empty references', () => {
  it('treats a reference to an empty cell as zero in plain arithmetic', () => {
    const cells = {};
    expect(formatFormulaValue(evaluateFormula('=C1*2', cells))).toBe('0');
    expect(formatFormulaValue(evaluateFormula('=C1+1', cells))).toBe('1');
    expect(formatFormulaValue(evaluateFormula('=A1+B1', { A1: '2', B1: '3' }))).toBe('5');
    expect(formatFormulaValue(evaluateFormula('=D1-E1', cells))).toBe('0');
  });

  it('still errors when arithmetic references a non-numeric text cell', () => {
    expect(evaluateFormula('=A1*2', { A1: 'East' })).toBe('#ERROR!');
  });

  it('propagates #REF! through arithmetic and aggregates', () => {
    expect(evaluateFormula('=A1+#REF!+1', {})).toBe('#REF!');
    expect(evaluateFormula('=SUM(#REF!:A1)', {})).toBe('#REF!');
  });
});

describe('REQ-4-2-2 stable formula error tokens', () => {
  it('division by zero displays #DIV/0!', () => {
    expect(evaluateFormula('=1/0', {})).toBe('#DIV/0!');
    expect(evaluateFormula('=A1/0', { A1: '5' })).toBe('#DIV/0!');
    expect(evaluateFormula('=AVERAGE(A1:B2)', {})).toBe('#DIV/0!');
  });

  it('an unsupported function displays #NAME?', () => {
    expect(evaluateFormula('=FOO(1)', {})).toBe('#NAME?');
    expect(evaluateFormula('=SUM(1,2)+BAR(3)', {})).toBe('#NAME?');
  });

  it('a malformed expression displays #ERROR!', () => {
    expect(evaluateFormula('=1+', {})).toBe('#ERROR!');
    expect(evaluateFormula('=(1+2', {})).toBe('#ERROR!');
    expect(evaluateFormula('=1 2', {})).toBe('#ERROR!');
    // arithmetic on non-numeric text is not one of the named error
    // categories, so it falls back to the malformed-expression token
    expect(evaluateFormula('=A1*2', { A1: 'East' })).toBe('#ERROR!');
  });

  it('an invalid reference displays #REF!', () => {
    expect(evaluateFormula('=A1+#REF!+1', {})).toBe('#REF!');
    expect(evaluateFormula('=SUM(#REF!:A1)', {})).toBe('#REF!');
    expect(evaluateFormula('=#REF!+B2', { B2: '5' })).toBe('#REF!');
  });

  it('a direct circular reference displays #REF!', () => {
    // the cell's own coordinate is seeded into the reference chain
    expect(evaluateFormula('=A1+1', { A1: '=A1+1' }, 0, ['A1'])).toBe('#REF!');
    expect(evaluateFormula('=SUM(A1:A2)', { A1: '=SUM(A1:A2)' }, 0, ['A1'])).toBe('#REF!');
  });

  it('an indirect circular reference displays #REF!', () => {
    const cells = { A1: '=B1+1', B1: '=A1+1' };
    expect(evaluateFormula('=A1+1', cells, 0, ['A1'])).toBe('#REF!');
    expect(evaluateFormula('=B1+1', cells, 0, ['B1'])).toBe('#REF!');
    expect(evaluateFormula('=A1+1', cells)).toBe('#REF!');
  });

  it('errors propagate to dependent formulas with the same token', () => {
    const text = { A1: 'abc', C1: '=A1+B1', D1: '=C1*2' };
    expect(evaluateFormula('=A1+B1', text, 0, ['C1'])).toBe('#ERROR!');
    expect(evaluateFormula('=C1*2', text, 0, ['D1'])).toBe('#ERROR!');
    const div = { C1: '=1/0', D1: '=C1*2' };
    expect(evaluateFormula('=C1*2', div, 0, ['D1'])).toBe('#DIV/0!');
    const name = { C1: '=FOO(1)', D1: '=C1*2' };
    expect(evaluateFormula('=C1*2', name, 0, ['D1'])).toBe('#NAME?');
    const ref = { C1: '=#REF!+1', D1: '=C1*2' };
    expect(evaluateFormula('=C1*2', ref, 0, ['D1'])).toBe('#REF!');
    const cycle = { A1: '=B1', B1: '=A1', C1: '=B1*2' };
    expect(evaluateFormula('=B1*2', cycle, 0, ['C1'])).toBe('#REF!');
  });

  it('an erroneous cell does not block unrelated aggregates', () => {
    const cells = { A1: 'abc', B1: '3', E1: '=SUM(A1:B1)' };
    expect(evaluateFormula('=SUM(A1:B1)', cells, 0, ['E1'])).toBe(3);
  });
});

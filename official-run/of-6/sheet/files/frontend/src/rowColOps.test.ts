import { describe, expect, it } from 'vitest';
import type { Sheet, Workbook } from './types';
import {
  adjustFormulaRefs,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  isCoordInRange,
  parseRange,
  pivotWithColDelete,
  pivotWithColInsert,
  pivotWithRowDelete,
  pivotWithRowInsert,
  refreshPivot,
  validationErrorForInput,
  workbookWithColDelete,
  workbookWithColInsert,
  workbookWithRowDelete,
  workbookWithRowInsert,
} from './rowColOps';
import { evaluateFormula } from './formula';

function seedSheet(): Sheet {
  return {
    id: 'sheet1',
    name: 'Sheet1',
    rowCount: 5,
    columnCount: 4,
    cells: {
      A1: 'Region',
      A2: 'East',
      B2: '1200',
      A3: 'North',
      B3: '800',
      B5: '=B2+B3',
    },
    filterViews: [{ id: 'fv1', name: 'Region filter' }],
    validationRules: [{ id: 'vr1', range: 'B2:B4', type: 'number', min: 0, max: 100 }],
  };
}

function seedWorkbook(sheet: Sheet = seedSheet()): Workbook {
  return {
    id: 'q3-sales',
    name: 'Q3 Sales',
    lastUpdated: '2026-09-25T10:00:00.000Z',
    activeSheetId: sheet.id,
    sheets: [
      sheet,
      { ...seedSheet(), id: 'sheet2', name: 'Sheet2', cells: { A2: 'Other' } },
    ],
    pivots: [
      {
        id: 'p1',
        name: 'Sales pivot',
        sheetId: sheet.id,
        sourceRange: 'A1:B4',
      },
    ],
  };
}

describe('parseRange / isCoordInRange', () => {
  it('parses A1:B4 style ranges and tests coordinates', () => {
    const r = parseRange('A1:B4');
    expect(r).toEqual({ startRow: 0, startCol: 0, endRow: 3, endCol: 1 });
    expect(isCoordInRange('A1', 'A1:B4')).toBe(true);
    expect(isCoordInRange('B4', 'A1:B4')).toBe(true);
    expect(isCoordInRange('C1', 'A1:B4')).toBe(false);
    expect(isCoordInRange('A5', 'A1:B4')).toBe(false);
    expect(parseRange('garbage')).toBeNull();
  });
});

describe('adjustFormulaRefs', () => {
  it('shifts references at or below an inserted row down by one', () => {
    expect(adjustFormulaRefs('=A1+B2', { insertRow: 1 })).toBe('=A1+B3');
    expect(adjustFormulaRefs('=SUM(A2:B4)', { insertRow: 1 })).toBe('=SUM(A3:B5)');
    expect(adjustFormulaRefs('=A1+B2', { insertRow: 0 })).toBe('=A2+B3');
  });

  it('shifts references above a deleted row up and marks deleted references as #REF!', () => {
    expect(adjustFormulaRefs('=A1+B3', { deleteRow: 1 })).toBe('=A1+B2');
    expect(adjustFormulaRefs('=A1+B2', { deleteRow: 1 })).toBe('=A1+#REF!');
    expect(adjustFormulaRefs('=SUM(A2:B2)', { deleteRow: 1 })).toBe('=SUM(#REF!:#REF!)');
  });

  it('shifts references at or right of an inserted column right by one', () => {
    expect(adjustFormulaRefs('=A1+B2', { insertColumn: 1 })).toBe('=A1+C2');
    expect(adjustFormulaRefs('=SUM(A1:B3)', { insertColumn: 1 })).toBe('=SUM(A1:C3)');
    expect(adjustFormulaRefs('=B2+C3', { insertColumn: 0 })).toBe('=C2+D3');
    expect(adjustFormulaRefs('=AA1+AB2', { insertColumn: 27 })).toBe('=AA1+AC2');
  });

  it('shifts references left of a deleted column left and marks deleted references as #REF!', () => {
    expect(adjustFormulaRefs('=A1+C3', { deleteColumn: 1 })).toBe('=A1+B3');
    expect(adjustFormulaRefs('=A1+B2', { deleteColumn: 1 })).toBe('=A1+#REF!');
    expect(adjustFormulaRefs('=SUM(A2:B2)', { deleteColumn: 1 })).toBe('=SUM(A2:#REF!)');
    expect(adjustFormulaRefs('=SUM(B2:B2)', { deleteColumn: 1 })).toBe('=SUM(#REF!:#REF!)');
    expect(adjustFormulaRefs('=B2+C3', { deleteColumn: 0 })).toBe('=A2+B3');
    expect(adjustFormulaRefs('=A1+B2', { deleteColumn: 0 })).toBe('=#REF!+A2');
  });

  it('rewrites references found anywhere in the given text (callers only pass formula cells)', () => {
    expect(adjustFormulaRefs('hello A2', { insertRow: 1 })).toBe('hello A3');
    expect(adjustFormulaRefs('no refs here', { insertRow: 1 })).toBe('no refs here');
  });
});

describe('insertRow', () => {
  it('shifts target and subsequent cells, rules and formula references downward together', () => {
    const sheet = seedSheet();
    const next = insertRow(sheet, 1); // insert above 1-based row 2

    expect(next.rowCount).toBe(6);
    expect(next.cells.A1).toBe('Region');
    expect(next.cells.A2).toBeUndefined(); // new blank row
    expect(next.cells.A3).toBe('East');
    expect(next.cells.B3).toBe('1200');
    expect(next.cells.A4).toBe('North');
    expect(next.cells.B4).toBe('800');
    // the formula moved from B5 to B6 and its references shifted
    expect(next.cells.B6).toBe('=B3+B4');
    expect(evaluateFormula(next.cells.B6, next.cells)).toBe(2000);

    // the validation rule shifted down with the data
    expect(next.validationRules).toEqual([
      { id: 'vr1', range: 'B3:B5', type: 'number', min: 0, max: 100 },
    ]);
    // filter views are carried over unchanged
    expect(next.filterViews).toEqual([{ id: 'fv1', name: 'Region filter' }]);
  });

  it('inserts a blank row below the target row', () => {
    const sheet = seedSheet();
    const next = insertRow(sheet, 2); // insert below 1-based row 2 => before old row 3

    expect(next.rowCount).toBe(6);
    expect(next.cells.A2).toBe('East');
    expect(next.cells.B2).toBe('1200');
    expect(next.cells.A3).toBeUndefined();
    expect(next.cells.A4).toBe('North');
    expect(next.cells.B4).toBe('800');
    expect(next.cells.B6).toBe('=B2+B4');
    expect(evaluateFormula(next.cells.B6, next.cells)).toBe(2000);
    expect(next.validationRules[0].range).toBe('B2:B5');
  });

  it('inserting above row 1 shifts everything down', () => {
    const sheet = seedSheet();
    const next = insertRow(sheet, 0);
    expect(next.cells.A2).toBe('Region');
    expect(next.cells.A3).toBe('East');
    expect(next.cells.A4).toBe('North');
    expect(next.cells.B6).toBe('=B3+B4');
    expect(next.validationRules[0].range).toBe('B3:B5');
  });
});

describe('deleteRow', () => {
  it('removes the target row, shifts subsequent cells up and adjusts formulas', () => {
    const sheet = seedSheet();
    const next = deleteRow(sheet, 1); // delete 1-based row 2 (East/1200)

    expect(next.rowCount).toBe(4);
    expect(next.cells.A1).toBe('Region');
    expect(next.cells.A2).toBe('North');
    expect(next.cells.B2).toBe('800');
    expect(next.cells.A3).toBeUndefined();
    // B5 formula moved to B4; B2 deleted so the reference becomes #REF!
    expect(next.cells.B4).toBe('=#REF!+B2');
    expect(evaluateFormula(next.cells.B4, next.cells)).toBe('#REF!');
  });

  it('removes validation rules located on the deleted row and shifts rules below', () => {
    const sheet = seedSheet();
    const next = deleteRow(sheet, 1); // rule B2:B4 spans the deleted row -> shrinks
    expect(next.validationRules).toEqual([
      { id: 'vr1', range: 'B2:B3', type: 'number', min: 0, max: 100 },
    ]);

    const ruleOnRow = { ...seedSheet(), validationRules: [{ id: 'vr2', range: 'B3:B3', type: 'number', min: 0, max: 100 }] };
    const afterDelete = deleteRow(ruleOnRow, 2); // delete 1-based row 3
    expect(afterDelete.validationRules).toEqual([]);

    const below = deleteRow(ruleOnRow, 1); // delete row 2, rule on row 3 shifts up
    expect(below.validationRules).toEqual([
      { id: 'vr2', range: 'B2:B2', type: 'number', min: 0, max: 100 },
    ]);
  });
});

describe('validationErrorForInput', () => {
  const sheet = seedSheet(); // rule B2:B4 number 0..100

  it('accepts values within range and rejects out-of-range values with the required message', () => {
    expect(validationErrorForInput(sheet, 'B2', '50')).toBeNull();
    expect(validationErrorForInput(sheet, 'B2', '0')).toBeNull();
    expect(validationErrorForInput(sheet, 'B2', '100')).toBeNull();
    expect(validationErrorForInput(sheet, 'B2', '150')).toBe(
      'Please enter a number from 0 to 100'
    );
    expect(validationErrorForInput(sheet, 'B3', '-5')).toBe(
      'Please enter a number from 0 to 100'
    );
    expect(validationErrorForInput(sheet, 'B3', 'abc')).toBe(
      'Please enter a number from 0 to 100'
    );
  });

  it('ignores cells outside the rule range, empty values and formulas', () => {
    expect(validationErrorForInput(sheet, 'C2', '999')).toBeNull();
    expect(validationErrorForInput(sheet, 'B2', '')).toBeNull();
    expect(validationErrorForInput(sheet, 'B2', '=1+1')).toBeNull();
  });
});

describe('pivot overlap and refresh', () => {
  const pivot = { id: 'p1', name: 'Sales', sheetId: 'sheet1', sourceRange: 'A1:B4' };

  it('keeps the stored result unchanged and marks the pivot stale when a change overlaps the source range', () => {
    const next = pivotWithRowInsert(pivot, 1);
    expect(next.stale).toBe(true);
    expect(next.sourceRange).toBe('A1:B4'); // result unchanged
    expect(next.adjustedRange).toBe('A1:B5');
  });

  it('does not mark the pivot stale when the change is below the source range', () => {
    expect(pivotWithRowInsert(pivot, 5)).toBe(pivot);
    expect(pivotWithRowDelete(pivot, 5)).toBe(pivot);
  });

  it('accumulates multiple pending adjustments', () => {
    const once = pivotWithRowInsert(pivot, 1);
    const twice = pivotWithRowInsert(once, 1);
    expect(twice.adjustedRange).toBe('A1:B6');
  });

  it('delete shrinks the range and collapses it when the whole range is deleted', () => {
    const shrunk = pivotWithRowDelete(pivot, 3); // delete last row of the range
    expect(shrunk.adjustedRange).toBe('A1:B3');
    const collapsed = pivotWithRowDelete({ ...pivot, sourceRange: 'A3:A3' }, 2);
    expect(collapsed.stale).toBe(true);
    expect(collapsed.adjustedRange).toBe('');
  });

  it('refresh applies the adjusted range and clears the stale state', () => {
    const next = refreshPivot(pivotWithRowInsert(pivot, 1));
    expect(next.stale).toBeUndefined();
    expect(next.adjustedRange).toBeUndefined();
    expect(next.sourceRange).toBe('A1:B5');
  });
});

describe('insertColumn', () => {
  it('shifts the target and subsequent columns right; rules and formula references follow', () => {
    const sheet = seedSheet();
    const next = insertColumn(sheet, 1); // insert left of 1-based column B

    expect(next.columnCount).toBe(5);
    expect(next.cells.A1).toBe('Region');
    expect(next.cells.A2).toBe('East');
    expect(next.cells.B2).toBeUndefined(); // new blank column
    expect(next.cells.C2).toBe('1200');
    expect(next.cells.C3).toBe('800');
    // the formula moved from B5 to C5 and its references shifted
    expect(next.cells.C5).toBe('=C2+C3');
    expect(evaluateFormula(next.cells.C5, next.cells)).toBe(2000);

    // the validation rule shifted right with the data
    expect(next.validationRules).toEqual([
      { id: 'vr1', range: 'C2:C4', type: 'number', min: 0, max: 100 },
    ]);
    // filter views are carried over unchanged
    expect(next.filterViews).toEqual([{ id: 'fv1', name: 'Region filter' }]);
  });

  it('inserts a blank column right of the target column and keeps the target column in place', () => {
    const sheet = seedSheet();
    const next = insertColumn(sheet, 2); // insert right of 1-based column B => before old column C

    expect(next.columnCount).toBe(5);
    expect(next.cells.B2).toBe('1200');
    expect(next.cells.B3).toBe('800');
    expect(next.cells.C2).toBeUndefined();
    expect(next.cells.B5).toBe('=B2+B3');
    expect(evaluateFormula(next.cells.B5, next.cells)).toBe(2000);
    expect(next.validationRules[0].range).toBe('B2:B4');
  });

  it('inserting left of column A shifts every column right', () => {
    const sheet = seedSheet();
    const next = insertColumn(sheet, 0);
    expect(next.cells.B1).toBe('Region');
    expect(next.cells.B2).toBe('East');
    expect(next.cells.C2).toBe('1200');
    expect(next.cells.C5).toBe('=C2+C3');
    expect(next.validationRules[0].range).toBe('C2:C4');
  });
});

describe('deleteColumn', () => {
  it('removes the target column, shifts subsequent cells left and adjusts formulas', () => {
    const sheet: Sheet = {
      ...seedSheet(),
      cells: {
        A1: 'Region',
        A2: 'East',
        B2: '1200',
        A3: 'North',
        B3: '800',
        C4: '=B2+B3',
      },
    };
    const next = deleteColumn(sheet, 1); // delete 1-based column B

    expect(next.columnCount).toBe(3);
    expect(next.cells.A1).toBe('Region');
    expect(next.cells.A2).toBe('East');
    expect(next.cells.A3).toBe('North');
    expect(next.cells.B2).toBeUndefined();
    // C4 formula moved to B4; B2 deleted so the reference becomes #REF!
    expect(next.cells.B4).toBe('=#REF!+#REF!');
    expect(evaluateFormula(next.cells.B4, next.cells)).toBe('#REF!');
  });

  it('removes validation rules located on the deleted column and shifts rules to the left', () => {
    const spanning = {
      ...seedSheet(),
      validationRules: [
        { id: 'vr1', range: 'B2:C4', type: 'number', min: 0, max: 100 },
      ],
    };
    const next = deleteColumn(spanning, 1); // rule B2:C4 spans the deleted column -> shrinks
    expect(next.validationRules).toEqual([
      { id: 'vr1', range: 'B2:B4', type: 'number', min: 0, max: 100 },
    ]);

    const ruleOnCol = {
      ...seedSheet(),
      validationRules: [
        { id: 'vr2', range: 'B2:B4', type: 'number', min: 0, max: 100 },
      ],
    };
    const afterDelete = deleteColumn(ruleOnCol, 1); // delete 1-based column B
    expect(afterDelete.validationRules).toEqual([]);

    const left = deleteColumn(ruleOnCol, 0); // delete column A, rule on B shifts left
    expect(left.validationRules).toEqual([
      { id: 'vr2', range: 'A2:A4', type: 'number', min: 0, max: 100 },
    ]);
  });
});

describe('pivot column overlap and refresh', () => {
  const pivot = { id: 'p1', name: 'Sales', sheetId: 'sheet1', sourceRange: 'A1:B4' };

  it('keeps the stored result unchanged and marks the pivot stale when a column change overlaps the source range', () => {
    const next = pivotWithColInsert(pivot, 1);
    expect(next.stale).toBe(true);
    expect(next.sourceRange).toBe('A1:B4'); // result unchanged
    expect(next.adjustedRange).toBe('A1:C4');
  });

  it('does not mark the pivot stale when the change is right of the source range', () => {
    expect(pivotWithColInsert(pivot, 3)).toBe(pivot);
    expect(pivotWithColDelete(pivot, 3)).toBe(pivot);
  });

  it('delete shrinks the range; a collapsed range requires field reselection on refresh and preserves the last successful result', () => {
    const shrunk = pivotWithColDelete(pivot, 1); // delete last column of the range
    expect(shrunk.stale).toBe(true);
    expect(shrunk.adjustedRange).toBe('A1:A4');

    const collapsed = pivotWithColDelete({ ...pivot, sourceRange: 'B1:B4' }, 1);
    expect(collapsed.stale).toBe(true);
    expect(collapsed.adjustedRange).toBe('');

    const refreshed = refreshPivot(collapsed);
    expect(refreshed.fieldError).toBe(true);
    expect(refreshed.sourceRange).toBe('B1:B4'); // last successful result preserved
    expect(refreshed.stale).toBeUndefined();
    expect(refreshed.adjustedRange).toBeUndefined();
  });

  it('refresh applies the adjusted range and clears the stale state', () => {
    const next = refreshPivot(pivotWithColInsert(pivot, 1));
    expect(next.stale).toBeUndefined();
    expect(next.adjustedRange).toBeUndefined();
    expect(next.sourceRange).toBe('A1:C4');
  });
});

describe('workbook-level column operations', () => {
  it('inserts only into the active sheet and only marks pivots on that sheet', () => {
    const wb = seedWorkbook();
    const next = workbookWithColInsert(wb, 'sheet1', 1);

    expect(next.sheets[0].cells.C2).toBe('1200');
    expect(next.sheets[1].cells).toEqual({ A2: 'Other' }); // other sheet unchanged
    expect(next.sheets[1].columnCount).toBe(4);
    expect(next.pivots[0].stale).toBe(true);

    // a pivot on the other sheet is untouched
    const otherPivot = { id: 'p2', name: 'Other', sheetId: 'sheet2', sourceRange: 'A1:B4' };
    const wb2 = { ...wb, pivots: [otherPivot] };
    const next2 = workbookWithColInsert(wb2, 'sheet1', 1);
    expect(next2.pivots[0]).toBe(otherPivot);
  });

  it('deletes only from the active sheet and keeps other worksheets intact', () => {
    const wb = seedWorkbook();
    const next = workbookWithColDelete(wb, 'sheet1', 1);
    expect(next.sheets[0].cells.B2).toBeUndefined();
    expect(next.sheets[0].cells.A2).toBe('East');
    expect(next.sheets[1].cells.A2).toBe('Other');
    expect(next.pivots[0].stale).toBe(true);
    expect(next.pivots[0].adjustedRange).toBe('A1:A4');
  });
});


describe('workbook-level row operations', () => {
  it('inserts only into the active sheet and only marks pivots on that sheet', () => {
    const wb = seedWorkbook();
    const next = workbookWithRowInsert(wb, 'sheet1', 1);

    expect(next.sheets[0].cells.A3).toBe('East');
    expect(next.sheets[1].cells).toEqual({ A2: 'Other' }); // other sheet unchanged
    expect(next.sheets[1].rowCount).toBe(5);
    expect(next.pivots[0].stale).toBe(true);

    // a pivot on the other sheet is untouched
    const otherPivot = { id: 'p2', name: 'Other', sheetId: 'sheet2', sourceRange: 'A1:B4' };
    const wb2 = { ...wb, pivots: [otherPivot] };
    const next2 = workbookWithRowInsert(wb2, 'sheet1', 1);
    expect(next2.pivots[0]).toBe(otherPivot);
  });

  it('deletes only from the active sheet and keeps other worksheets intact', () => {
    const wb = seedWorkbook();
    const next = workbookWithRowDelete(wb, 'sheet1', 1);
    expect(next.sheets[0].cells.A2).toBe('North');
    expect(next.sheets[0].cells.B2).toBe('800');
    expect(next.sheets[1].cells.A2).toBe('Other');
    expect(next.pivots[0].stale).toBe(true);
    expect(next.pivots[0].adjustedRange).toBe('A1:B3');
  });
});

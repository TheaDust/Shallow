import { describe, expect, it } from 'vitest';
import type { Sheet, ValidationRule } from './types';
import {
  deleteColumn,
  deleteRow,
  dropdownValuesForCoord,
  insertColumn,
  insertRow,
  numberValidationMessage,
  validationErrorForInput,
  validationRuleForCoord,
} from './rowColOps';

function sheetWithRules(rules: ValidationRule[]): Sheet {
  return {
    id: 'sheet1',
    name: 'Sheet1',
    rowCount: 10,
    columnCount: 6,
    cells: {
      A1: 'Region',
      A2: 'East',
      B2: '1200',
      A3: 'North',
      B3: '800',
    },
    filterViews: [],
    validationRules: rules,
  };
}

describe('dropdown validation (REQ-5-2-1)', () => {
  const dropdownRule: ValidationRule = {
    id: 'vr1',
    range: 'A1:A2',
    type: 'dropdown',
    values: ['East', 'North', 'South'],
  };

  it('accepts values from the trimmed allowed list and rejects others with the exact message', () => {
    const sheet = sheetWithRules([dropdownRule]);
    expect(validationErrorForInput(sheet, 'A1', 'East')).toBeNull();
    expect(validationErrorForInput(sheet, 'A2', 'South')).toBeNull();
    expect(validationErrorForInput(sheet, 'A1', 'West')).toBe(
      'Please select one of the following values: East, North, South'
    );
    // input values are compared to the trimmed allowed items (leading and
    // trailing spaces on the typed value are ignored)
    expect(validationErrorForInput(sheet, 'A1', ' East ')).toBeNull();
  });

  it('ignores cells outside the rule range, empty inputs and formulas', () => {
    const sheet = sheetWithRules([dropdownRule]);
    expect(validationErrorForInput(sheet, 'B1', 'anything')).toBeNull();
    expect(validationErrorForInput(sheet, 'A1', '')).toBeNull();
    expect(validationErrorForInput(sheet, 'A1', '=1+1')).toBeNull();
  });

  it('an empty allowed list rejects every non-empty value', () => {
    const sheet = sheetWithRules([
      { id: 'vr2', range: 'B1:B2', type: 'dropdown', values: [] },
    ]);
    expect(validationErrorForInput(sheet, 'B1', 'x')).toBe(
      'Please select one of the following values: '
    );
    expect(validationErrorForInput(sheet, 'B1', '')).toBeNull();
  });

  it('exposes the dropdown values and rule for a constrained coordinate', () => {
    const sheet = sheetWithRules([dropdownRule]);
    expect(validationRuleForCoord(sheet, 'A1')).toEqual(dropdownRule);
    expect(dropdownValuesForCoord(sheet, 'A2')).toEqual(['East', 'North', 'South']);
    expect(dropdownValuesForCoord(sheet, 'B1')).toBeNull();
    expect(validationRuleForCoord(sheet, 'C5')).toBeNull();
  });
});

describe('numeric validation messages (REQ-5-2-1)', () => {
  it('the persisted 0-to-100 boundary uses the exact quoted message', () => {
    expect(numberValidationMessage(0, 100)).toBe('Please enter a number from 0 to 100');
    const sheet = sheetWithRules([
      { id: 'vr1', range: 'B2:B4', type: 'number', min: 0, max: 100 },
    ]);
    expect(validationErrorForInput(sheet, 'B3', '101')).toBe(
      'Please enter a number from 0 to 100'
    );
    expect(validationErrorForInput(sheet, 'B3', '100')).toBeNull();
    expect(validationErrorForInput(sheet, 'B3', '0')).toBeNull();
  });

  it('other inclusive number ranges use the between <minimum> and <maximum> wording', () => {
    expect(numberValidationMessage(10, 50)).toBe(
      'Please enter a number between 10 and 50'
    );
    const sheet = sheetWithRules([
      { id: 'vr1', range: 'B2:B4', type: 'number', min: 10, max: 50 },
    ]);
    expect(validationErrorForInput(sheet, 'B2', '51')).toBe(
      'Please enter a number between 10 and 50'
    );
    expect(validationErrorForInput(sheet, 'B2', '9')).toBe(
      'Please enter a number between 10 and 50'
    );
    expect(validationErrorForInput(sheet, 'B2', 'text')).toBe(
      'Please enter a number between 10 and 50'
    );
    expect(validationErrorForInput(sheet, 'B2', '25')).toBeNull();
  });
});

describe('rules move with the originally constrained cells after structure changes', () => {
  it('inserting a row above shifts a dropdown rule range down with the cells', () => {
    const sheet = sheetWithRules([
      { id: 'vr1', range: 'A2:A3', type: 'dropdown', values: ['East', 'North'] },
    ]);
    const next = insertRow(sheet, 0); // insert above row 1
    expect(next.validationRules).toEqual([
      { id: 'vr1', range: 'A3:A4', type: 'dropdown', values: ['East', 'North'] },
    ]);
    // the constrained cells moved down with the rule
    expect(dropdownValuesForCoord(next, 'A3')).toEqual(['East', 'North']);
    expect(dropdownValuesForCoord(next, 'A1')).toBeNull();
  });

  it('deleting a row removes rules fully on that row and shifts rules below', () => {
    const sheet = sheetWithRules([
      { id: 'vr1', range: 'A2:A3', type: 'dropdown', values: ['East', 'North'] },
    ]);
    const next = deleteRow(sheet, 1); // delete 1-based row 2
    expect(next.validationRules).toEqual([
      { id: 'vr1', range: 'A2:A2', type: 'dropdown', values: ['East', 'North'] },
    ]);
  });

  it('column insertions shift dropdown rules right with the cells', () => {
    const sheet = sheetWithRules([
      { id: 'vr1', range: 'A2:A3', type: 'dropdown', values: ['East', 'North'] },
    ]);
    const next = insertColumn(sheet, 0);
    expect(next.validationRules).toEqual([
      { id: 'vr1', range: 'B2:B3', type: 'dropdown', values: ['East', 'North'] },
    ]);
    expect(dropdownValuesForCoord(next, 'B2')).toEqual(['East', 'North']);
  });

  it('column deletions remove dropdown rules on the target column', () => {
    const sheet = sheetWithRules([
      { id: 'vr1', range: 'A2:A3', type: 'dropdown', values: ['East', 'North'] },
    ]);
    const next = deleteColumn(sheet, 0);
    expect(next.validationRules).toEqual([]);
  });
});

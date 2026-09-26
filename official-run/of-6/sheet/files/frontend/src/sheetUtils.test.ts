import { describe, expect, it } from 'vitest';
import { nextSheetName } from './sheetUtils';

describe('nextSheetName', () => {
  it('returns Sheet1 when no worksheets exist', () => {
    expect(nextSheetName([])).toBe('Sheet1');
  });

  it('returns Sheet2 when only Sheet1 exists', () => {
    expect(nextSheetName(['Sheet1'])).toBe('Sheet2');
  });

  it('returns the first unused name when numbering has gaps', () => {
    expect(nextSheetName(['Sheet1', 'Sheet3'])).toBe('Sheet2');
    expect(nextSheetName(['Sheet2', 'Sheet3'])).toBe('Sheet1');
    expect(nextSheetName(['Sheet1', 'Sheet2', 'Sheet4'])).toBe('Sheet3');
  });

  it('skips non-SheetN names and compares trimmed, exact names', () => {
    expect(nextSheetName(['Sheet1', 'Totals', 'Sheet 2', 'sheet2'])).toBe('Sheet2');
    expect(nextSheetName(['Sheet1', 'Sheet2', '  Sheet2  ', 'Sheet3'])).toBe('Sheet4');
  });

  it('continues past the highest existing number when no gaps remain', () => {
    expect(nextSheetName(['Sheet1', 'Sheet2', 'Sheet3'])).toBe('Sheet4');
    expect(nextSheetName(['Sheet1', 'Sheet2', 'Sheet3', 'Sheet4'])).toBe('Sheet5');
  });
});

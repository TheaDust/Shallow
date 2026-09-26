import { describe, expect, it } from 'vitest';
import { shiftCoord } from './gridUtils';

describe('shiftCoord', () => {
  it('shifts coordinates after a row insertion at or below the insert index', () => {
    expect(shiftCoord('A1', { insertRow: 2 })).toBe('A1');
    expect(shiftCoord('A3', { insertRow: 2 })).toBe('A4');
    expect(shiftCoord('C5', { insertRow: 0 })).toBe('C6');
  });

  it('shifts coordinates after a column insertion at or to the right of the insert index', () => {
    expect(shiftCoord('A1', { insertColumn: 3 })).toBe('A1');
    expect(shiftCoord('D1', { insertColumn: 3 })).toBe('E1');
    expect(shiftCoord('B2', { insertColumn: 1 })).toBe('C2');
  });

  it('returns null for coordinates on a deleted row or column and shifts beyond it', () => {
    expect(shiftCoord('A2', { deleteRow: 1 })).toBeNull();
    expect(shiftCoord('A3', { deleteRow: 1 })).toBe('A2');
    expect(shiftCoord('A1', { deleteRow: 1 })).toBe('A1');
    expect(shiftCoord('B1', { deleteColumn: 1 })).toBeNull();
    expect(shiftCoord('C1', { deleteColumn: 1 })).toBe('B1');
    expect(shiftCoord('A1', { deleteColumn: 1 })).toBe('A1');
  });

  it('applies row and column changes together', () => {
    expect(shiftCoord('D3', { insertRow: 2, insertColumn: 3 })).toBe('E4');
    expect(shiftCoord('D3', { deleteRow: 2, deleteColumn: 3 })).toBeNull();
  });
});

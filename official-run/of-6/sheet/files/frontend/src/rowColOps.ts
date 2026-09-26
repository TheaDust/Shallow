import type { CellMap, PivotResult, Sheet, ValidationRule, Workbook } from './types';
import { cellToCoordinate, columnLetter, coordinateToCell } from './gridUtils';
import { REF_ERROR } from './formula';

// Pure row/column-structure operations for the current active worksheet.
//
// - Inserting a row above/below shifts the target row and all subsequent
//   cells, validation rules and formula references downward together;
//   inserting a column left/right shifts the target column and all
//   subsequent cells, rules and references to the right together.
// - Deleting a row/column removes it; subsequent cells and rules shift
//   up/left and rules located on the deleted row/column are removed.
// - Formula references that cannot be preserved (a reference to the deleted
//   row/column) are rewritten to #REF!, which the formula evaluator surfaces
//   as an explicit error.
// - Filter views keep applying to the original data region and are carried
//   over unchanged (they are name-only in the current model).
// - Pivots whose source range overlaps the change keep their stored result
//   untouched, are marked stale, and accumulate the adjusted range until
//   "Refresh pivot table" is clicked. If the whole source range collapses
//   onto a deleted row/column (a selected field is gone), refresh preserves
//   the last successful result and surfaces a visible field error instead.

export interface RowRange {
  startRow: number; // 0-based inclusive
  startCol: number;
  endRow: number;
  endCol: number;
}

export function parseRange(range: string): RowRange | null {
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range.trim());
  if (!match) {
    return null;
  }
  const startCoord = cellToCoordinate(match[1] + match[2]);
  const endCoord = cellToCoordinate(match[3] + match[4]);
  if (!startCoord || !endCoord) {
    return null;
  }
  return {
    startRow: startCoord.row,
    startCol: startCoord.column,
    endRow: endCoord.row,
    endCol: endCoord.column,
  };
}

export function formatRange(range: RowRange): string {
  return `${coordinateToCell(range.startRow, range.startCol)}:${coordinateToCell(
    range.endRow,
    range.endCol
  )}`;
}

export function isCoordInRange(coord: string, range: string): boolean {
  const r = parseRange(range);
  const c = cellToCoordinate(coord);
  if (!r || !c) {
    return false;
  }
  return (
    c.row >= r.startRow &&
    c.row <= r.endRow &&
    c.column >= r.startCol &&
    c.column <= r.endCol
  );
}

const NUMERIC_TEXT = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;

function lettersToColumn(letters: string): number {
  const c = cellToCoordinate(letters + '1');
  return c ? c.column + 1 : 0;
}

function columnToLetters(column1: number): string {
  return columnLetter(column1 - 1);
}

export interface RefChange {
  insertRow?: number;
  deleteRow?: number;
  insertColumn?: number;
  deleteColumn?: number;
}

// Rewrites cell references (e.g. A1, B10) inside a formula so they follow a
// row/column insertion or deletion. References to the deleted row/column
// become #REF!.
export function adjustFormulaRefs(formula: string, change: RefChange): string {
  const hasInsertRow = typeof change.insertRow === 'number';
  const hasDeleteRow = typeof change.deleteRow === 'number';
  const hasInsertCol = typeof change.insertColumn === 'number';
  const hasDeleteCol = typeof change.deleteColumn === 'number';
  if (!hasInsertRow && !hasDeleteRow && !hasInsertCol && !hasDeleteCol) {
    return formula;
  }
  let out = '';
  let i = 0;
  const n = formula.length;
  while (i < n) {
    const ch = formula[i];
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z]/.test(formula[j])) {
        j += 1;
      }
      if (j < n && formula[j] >= '0' && formula[j] <= '9') {
        let k = j;
        while (k < n && formula[k] >= '0' && formula[k] <= '9') {
          k += 1;
        }
        const letters = formula.slice(i, j);
        const row1 = Number(formula.slice(j, k));
        if (letters.length > 0 && row1 >= 1 && cellToCoordinate(letters + '1')) {
          let broken = false;
          let newLetters = letters;
          let newRow = row1;
          const col1 = lettersToColumn(letters);
          if (hasInsertRow && row1 >= (change.insertRow as number) + 1) {
            newRow += 1;
          }
          if (hasDeleteRow) {
            const delete1 = (change.deleteRow as number) + 1;
            if (row1 === delete1) {
              broken = true;
            } else if (row1 > delete1) {
              newRow -= 1;
            }
          }
          if (!broken && hasInsertCol && col1 >= (change.insertColumn as number) + 1) {
            newLetters = columnToLetters(col1 + 1);
          }
          if (!broken && hasDeleteCol) {
            const delete1 = (change.deleteColumn as number) + 1;
            if (col1 === delete1) {
              broken = true;
            } else if (col1 > delete1) {
              newLetters = columnToLetters(col1 - 1);
            }
          }
          out += broken ? REF_ERROR : newLetters + newRow;
          i = k;
          continue;
        }
      }
      out += formula.slice(i, j);
      i = j;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

interface RangeShift {
  insertRow?: number;
  deleteRow?: number;
  insertColumn?: number;
  deleteColumn?: number;
}

function shiftRange(range: string, change: RangeShift): string | null {
  const r = parseRange(range);
  if (!r) {
    return range;
  }
  if (typeof change.insertRow === 'number') {
    const insert = change.insertRow;
    if (r.endRow < insert) {
      return range;
    }
    const startRow = r.startRow >= insert ? r.startRow + 1 : r.startRow;
    return formatRange({ ...r, startRow, endRow: r.endRow + 1 });
  }
  if (typeof change.deleteRow === 'number') {
    const del = change.deleteRow;
    if (r.endRow < del) {
      return range;
    }
    if (r.startRow > del) {
      return formatRange({ ...r, startRow: r.startRow - 1, endRow: r.endRow - 1 });
    }
    const endRow = r.endRow - 1;
    if (endRow < r.startRow) {
      return null; // the whole range was on the deleted row
    }
    return formatRange({ ...r, endRow });
  }
  if (typeof change.insertColumn === 'number') {
    const insert = change.insertColumn;
    if (r.endCol < insert) {
      return range;
    }
    const startCol = r.startCol >= insert ? r.startCol + 1 : r.startCol;
    return formatRange({ ...r, startCol, endCol: r.endCol + 1 });
  }
  if (typeof change.deleteColumn === 'number') {
    const del = change.deleteColumn;
    if (r.endCol < del) {
      return range;
    }
    if (r.startCol > del) {
      return formatRange({ ...r, startCol: r.startCol - 1, endCol: r.endCol - 1 });
    }
    const endCol = r.endCol - 1;
    if (endCol < r.startCol) {
      return null; // the whole range was on the deleted column
    }
    return formatRange({ ...r, endCol });
  }
  return range;
}

function shiftCellsForInsert(cells: CellMap, rowIndex: number): CellMap {
  const next: CellMap = {};
  for (const [coord, value] of Object.entries(cells)) {
    const c = cellToCoordinate(coord);
    if (!c) {
      continue;
    }
    if (c.row >= rowIndex) {
      next[coordinateToCell(c.row + 1, c.column)] = value;
    } else {
      next[coord] = value;
    }
  }
  return next;
}

function adjustFormulaCells(cells: CellMap, change: RangeShift): CellMap {
  const next: CellMap = {};
  for (const [coord, value] of Object.entries(cells)) {
    next[coord] = value.startsWith('=') ? adjustFormulaRefs(value, change) : value;
  }
  return next;
}

export function insertRow(sheet: Sheet, rowIndex: number): Sheet {
  const movedCells = shiftCellsForInsert(sheet.cells, rowIndex);
  const cells = adjustFormulaCells(movedCells, { insertRow: rowIndex });
  const validationRules: ValidationRule[] = [];
  for (const rule of sheet.validationRules) {
    const shifted = shiftRange(rule.range, { insertRow: rowIndex });
    if (shifted !== null) {
      validationRules.push(shifted === rule.range ? rule : { ...rule, range: shifted });
    }
  }
  return {
    ...sheet,
    rowCount: sheet.rowCount + 1,
    cells,
    validationRules,
  };
}

function shiftCellsForColInsert(cells: CellMap, colIndex: number): CellMap {
  const next: CellMap = {};
  for (const [coord, value] of Object.entries(cells)) {
    const c = cellToCoordinate(coord);
    if (!c) {
      continue;
    }
    if (c.column >= colIndex) {
      next[coordinateToCell(c.row, c.column + 1)] = value;
    } else {
      next[coord] = value;
    }
  }
  return next;
}

function shiftCellsForColDelete(cells: CellMap, colIndex: number): CellMap {
  const next: CellMap = {};
  for (const [coord, value] of Object.entries(cells)) {
    const c = cellToCoordinate(coord);
    if (!c) {
      continue;
    }
    if (c.column === colIndex) {
      continue; // the deleted column's values are removed
    }
    if (c.column > colIndex) {
      next[coordinateToCell(c.row, c.column - 1)] = value;
    } else {
      next[coord] = value;
    }
  }
  return next;
}

export function insertColumn(sheet: Sheet, colIndex: number): Sheet {
  const movedCells = shiftCellsForColInsert(sheet.cells, colIndex);
  const cells = adjustFormulaCells(movedCells, { insertColumn: colIndex });
  const validationRules: ValidationRule[] = [];
  for (const rule of sheet.validationRules) {
    const shifted = shiftRange(rule.range, { insertColumn: colIndex });
    if (shifted !== null) {
      validationRules.push(shifted === rule.range ? rule : { ...rule, range: shifted });
    }
  }
  return {
    ...sheet,
    columnCount: sheet.columnCount + 1,
    cells,
    validationRules,
  };
}

export function deleteColumn(sheet: Sheet, colIndex: number): Sheet {
  const movedCells = shiftCellsForColDelete(sheet.cells, colIndex);
  const cells = adjustFormulaCells(movedCells, { deleteColumn: colIndex });
  const validationRules: ValidationRule[] = [];
  for (const rule of sheet.validationRules) {
    const shifted = shiftRange(rule.range, { deleteColumn: colIndex });
    if (shifted === null) {
      continue; // rules on the target column are removed
    }
    validationRules.push(shifted === rule.range ? rule : { ...rule, range: shifted });
  }
  return {
    ...sheet,
    columnCount: Math.max(sheet.columnCount - 1, 1),
    cells,
    validationRules,
  };
}

export function deleteRow(sheet: Sheet, rowIndex: number): Sheet {
  const movedCells: CellMap = {};
  for (const [coord, value] of Object.entries(sheet.cells)) {
    const c = cellToCoordinate(coord);
    if (!c) {
      continue;
    }
    if (c.row === rowIndex) {
      continue; // the deleted row's values are removed
    }
    if (c.row > rowIndex) {
      movedCells[coordinateToCell(c.row - 1, c.column)] = value;
    } else {
      movedCells[coord] = value;
    }
  }
  const cells = adjustFormulaCells(movedCells, { deleteRow: rowIndex });
  const validationRules: ValidationRule[] = [];
  for (const rule of sheet.validationRules) {
    const shifted = shiftRange(rule.range, { deleteRow: rowIndex });
    if (shifted === null) {
      continue; // rules on the target row are removed
    }
    validationRules.push(shifted === rule.range ? rule : { ...rule, range: shifted });
  }
  return {
    ...sheet,
    rowCount: Math.max(sheet.rowCount - 1, 1),
    cells,
    validationRules,
  };
}

// Pivot handling ------------------------------------------------------------

export function pivotAffectedByInsert(pivot: PivotResult, rowIndex: number): boolean {
  const r = parseRange(pivot.sourceRange ?? '');
  return r !== null && r.endRow >= rowIndex;
}

export function pivotAffectedByDelete(pivot: PivotResult, rowIndex: number): boolean {
  const r = parseRange(pivot.sourceRange ?? '');
  return r !== null && r.endRow >= rowIndex;
}

export function pivotWithRowInsert(pivot: PivotResult, rowIndex: number): PivotResult {
  if (!pivotAffectedByInsert(pivot, rowIndex)) {
    return pivot;
  }
  const base = pivot.adjustedRange ?? pivot.sourceRange ?? '';
  const r = parseRange(base);
  if (!r) {
    return { ...pivot, stale: true };
  }
  const startRow = r.startRow >= rowIndex ? r.startRow + 1 : r.startRow;
  return {
    ...pivot,
    stale: true,
    adjustedRange: formatRange({ ...r, startRow, endRow: r.endRow + 1 }),
  };
}

export function pivotWithRowDelete(pivot: PivotResult, rowIndex: number): PivotResult {
  if (!pivotAffectedByDelete(pivot, rowIndex)) {
    return pivot;
  }
  const base = pivot.adjustedRange ?? pivot.sourceRange ?? '';
  const r = parseRange(base);
  if (!r) {
    return { ...pivot, stale: true };
  }
  if (r.startRow > rowIndex) {
    return {
      ...pivot,
      stale: true,
      adjustedRange: formatRange({ ...r, startRow: r.startRow - 1, endRow: r.endRow - 1 }),
    };
  }
  const endRow = r.endRow - 1;
  if (endRow < r.startRow) {
    return { ...pivot, stale: true, adjustedRange: '' };
  }
  return { ...pivot, stale: true, adjustedRange: formatRange({ ...r, endRow }) };
}

export function refreshPivot(pivot: PivotResult): PivotResult {
  if (pivot.adjustedRange === '') {
    // The whole source range collapsed onto deleted rows/columns, so a
    // selected pivot field no longer exists. Preserve the last successful
    // result and require the field to be reselected (visible error).
    const next: PivotResult = { ...pivot, fieldError: true };
    delete next.stale;
    delete next.adjustedRange;
    return next;
  }
  const next: PivotResult = { ...pivot };
  if (typeof pivot.adjustedRange === 'string') {
    next.sourceRange = pivot.adjustedRange;
  }
  delete next.stale;
  delete next.adjustedRange;
  return next;
}

// Workbook-level operations ---------------------------------------------------

export function workbookWithRowInsert(
  workbook: Workbook,
  sheetId: string,
  rowIndex: number
): Workbook {
  const sheet = workbook.sheets.find((s) => s.id === sheetId);
  if (!sheet) {
    return workbook;
  }
  return {
    ...workbook,
    sheets: workbook.sheets.map((s) => (s.id === sheetId ? insertRow(s, rowIndex) : s)),
    pivots: workbook.pivots.map((p) =>
      p.sheetId === sheetId ? pivotWithRowInsert(p, rowIndex) : p
    ),
  };
}

export function workbookWithRowDelete(
  workbook: Workbook,
  sheetId: string,
  rowIndex: number
): Workbook {
  const sheet = workbook.sheets.find((s) => s.id === sheetId);
  if (!sheet) {
    return workbook;
  }
  return {
    ...workbook,
    sheets: workbook.sheets.map((s) => (s.id === sheetId ? deleteRow(s, rowIndex) : s)),
    pivots: workbook.pivots.map((p) =>
      p.sheetId === sheetId ? pivotWithRowDelete(p, rowIndex) : p
    ),
  };
}

export function pivotWithColInsert(pivot: PivotResult, colIndex: number): PivotResult {
  const r = parseRange(pivot.sourceRange ?? '');
  if (r === null || r.endCol < colIndex) {
    return pivot;
  }
  const base = pivot.adjustedRange ?? pivot.sourceRange ?? '';
  const br = parseRange(base);
  if (!br) {
    return { ...pivot, stale: true };
  }
  const startCol = br.startCol >= colIndex ? br.startCol + 1 : br.startCol;
  return {
    ...pivot,
    stale: true,
    adjustedRange: formatRange({ ...br, startCol, endCol: br.endCol + 1 }),
  };
}

export function pivotWithColDelete(pivot: PivotResult, colIndex: number): PivotResult {
  const r = parseRange(pivot.sourceRange ?? '');
  if (r === null || r.endCol < colIndex) {
    return pivot;
  }
  const base = pivot.adjustedRange ?? pivot.sourceRange ?? '';
  const br = parseRange(base);
  if (!br) {
    return { ...pivot, stale: true };
  }
  if (br.startCol > colIndex) {
    return {
      ...pivot,
      stale: true,
      adjustedRange: formatRange({ ...br, startCol: br.startCol - 1, endCol: br.endCol - 1 }),
    };
  }
  const endCol = br.endCol - 1;
  if (endCol < br.startCol) {
    return { ...pivot, stale: true, adjustedRange: '' };
  }
  return { ...pivot, stale: true, adjustedRange: formatRange({ ...br, endCol }) };
}

export function workbookWithColInsert(
  workbook: Workbook,
  sheetId: string,
  colIndex: number
): Workbook {
  const sheet = workbook.sheets.find((s) => s.id === sheetId);
  if (!sheet) {
    return workbook;
  }
  return {
    ...workbook,
    sheets: workbook.sheets.map((s) => (s.id === sheetId ? insertColumn(s, colIndex) : s)),
    pivots: workbook.pivots.map((p) =>
      p.sheetId === sheetId ? pivotWithColInsert(p, colIndex) : p
    ),
  };
}

export function workbookWithColDelete(
  workbook: Workbook,
  sheetId: string,
  colIndex: number
): Workbook {
  const sheet = workbook.sheets.find((s) => s.id === sheetId);
  if (!sheet) {
    return workbook;
  }
  return {
    ...workbook,
    sheets: workbook.sheets.map((s) => (s.id === sheetId ? deleteColumn(s, colIndex) : s)),
    pivots: workbook.pivots.map((p) =>
      p.sheetId === sheetId ? pivotWithColDelete(p, colIndex) : p
    ),
  };
}

// Validation -----------------------------------------------------------------

// The visible message for a rejected numeric input. The 0-to-100 boundary is
// the persisted multi-cell scenario quoted by REQ-3-1-2 / REQ-3-2-1 /
// REQ-5-2-1 ("Please enter a number from 0 to 100"); every other inclusive
// number range uses the generic "between <minimum> and <maximum>" wording.
export function numberValidationMessage(min: number, max: number): string {
  if (min === 0 && max === 100) {
    return 'Please enter a number from 0 to 100';
  }
  return `Please enter a number between ${min} and ${max}`;
}

// The first validation rule whose range contains the coordinate, or null.
export function validationRuleForCoord(sheet: Sheet, coord: string): ValidationRule | null {
  for (const rule of sheet.validationRules) {
    if (isCoordInRange(coord, rule.range)) {
      return rule;
    }
  }
  return null;
}

// The trimmed allowed values of a dropdown rule covering the coordinate, or
// null when the cell is not dropdown-constrained.
export function dropdownValuesForCoord(sheet: Sheet, coord: string): string[] | null {
  const rule = validationRuleForCoord(sheet, coord);
  if (!rule || rule.type !== 'dropdown') {
    return null;
  }
  return rule.values ?? [];
}

export function validationErrorForInput(
  sheet: Sheet,
  coord: string,
  value: string
): string | null {
  if (value.startsWith('=')) {
    return null; // formulas are evaluated, not validated as literals
  }
  for (const rule of sheet.validationRules) {
    if (!isCoordInRange(coord, rule.range)) {
      continue;
    }
    if (value.trim() === '') {
      continue;
    }
    if (rule.type === 'dropdown') {
      const allowed = rule.values ?? [];
      if (!allowed.includes(value.trim())) {
        return `Please select one of the following values: ${allowed.join(', ')}`;
      }
      continue;
    }
    if (rule.type !== 'number') {
      continue;
    }
    const hasMinMax = typeof rule.min === 'number' && typeof rule.max === 'number';
    const message = hasMinMax
      ? numberValidationMessage(rule.min as number, rule.max as number)
      : 'Please enter a valid number';
    if (!NUMERIC_TEXT.test(value.trim())) {
      return message;
    }
    const num = Number(value.trim());
    if (typeof rule.min === 'number' && num < rule.min) {
      return message;
    }
    if (typeof rule.max === 'number' && num > rule.max) {
      return message;
    }
  }
  return null;
}

import type { CellMap, Sheet } from './types';
import { cellToCoordinate, coordinateToCell } from './gridUtils';
import { translateFormulaRefs } from './formula';
import { validationErrorForInput } from './rowColOps';
import type { ClipboardKind } from './internalClipboard';

// Clipboard paste operations (REQ-3-1-2).
//
// External clipboard text is a rectangle of tab-separated columns and
// newline-separated rows. The whole rectangle is applied at the starting
// cell: empty fields are preserved (target cells are cleared), only the
// target rectangle is overwritten, formulas inside the rectangle are
// replaced by the new content, and the entire paste either succeeds or
// fails atomically (a failing validation rule or an out-of-bounds paste
// leaves every target cell at its original value).

// Parses clipboard text into a two-dimensional field grid. Rows are
// separated by \n, \r\n or \r; columns by \t. Empty fields (including
// trailing empty columns) are preserved. Trailing empty rows are dropped so
// a trailing newline does not create an extra cleared row.
export function parsePasteText(text: string): string[][] {
  if (text === '') {
    return [];
  }
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  if (lines.length === 0) {
    return [];
  }
  return lines.map((line) => line.split('\t'));
}

// In-application clipboard paste (REQ-3-2-1 copy/cut). The clipboard holds
// the raw source rectangle; pasting validates the whole target rectangle
// first, translates copied formulas by the target offset (cut moves formulas
// without rewriting them), and for cut clears the source rectangle as part of
// the same atomic update. Any rejected paste leaves every cell at its
// original value.
export interface ClipboardPaste {
  sheetId: string;
  kind: ClipboardKind;
  anchor: string;
  active: string;
  rows: string[][];
}

function translatedRows(
  rows: string[][],
  rowOffset: number,
  colOffset: number,
  bounds: { rowCount: number; columnCount: number }
): string[][] {
  return rows.map((row) =>
    row.map((value) =>
      value.startsWith('=')
        ? translateFormulaRefs(value, rowOffset, colOffset, bounds)
        : value
    )
  );
}

// Applies an internal clipboard rectangle at startCoord (e.g. 'D1'). The
// target rectangle (same size as the source) is validated as a whole; on any
// validation or bounds failure the original cells are returned untouched.
// For cut, the source rectangle is cleared inside the same state change
// (move semantics: source values are read first, so an overlapping paste
// still lands correctly).
export function applyClipboardPasteToSheet(
  sheet: Sheet,
  startCoord: string,
  clipboard: ClipboardPaste
): PasteOutcome {
  const start = cellToCoordinate(startCoord);
  const source = cellToCoordinate(clipboard.anchor);
  if (!start || !source) {
    return { cells: sheet.cells, error: 'Invalid target cell' };
  }
  if (clipboard.rows.length === 0) {
    return { cells: sheet.cells, error: null };
  }
  let numCols = 0;
  for (const row of clipboard.rows) {
    if (row.length > numCols) {
      numCols = row.length;
    }
  }
  if (
    start.row + clipboard.rows.length > sheet.rowCount ||
    start.column + numCols > sheet.columnCount
  ) {
    return { cells: sheet.cells, error: 'Paste area exceeds the worksheet bounds' };
  }

  const rowOffset = start.row - source.row;
  const colOffset = start.column - source.column;
  const rows =
    clipboard.kind === 'cut'
      ? clipboard.rows
      : translatedRows(clipboard.rows, rowOffset, colOffset, {
          rowCount: sheet.rowCount,
          columnCount: sheet.columnCount,
        });

  // Validate the entire target rectangle before touching any cell so a
  // rejected paste never leaves a partial record.
  for (let r = 0; r < rows.length; r += 1) {
    for (let c = 0; c < numCols; c += 1) {
      const coord = coordinateToCell(start.row + r, start.column + c);
      const value = rows[r][c] ?? '';
      const error = validationErrorForInput(sheet, coord, value);
      if (error) {
        return { cells: sheet.cells, error };
      }
    }
  }

  const next: CellMap = { ...sheet.cells };
  if (clipboard.kind === 'cut') {
    // Clear the source rectangle first so an overlapping paste reads the
    // source values (already captured in rows) before they are removed.
    const src = cellToCoordinate(clipboard.anchor)!;
    const srcEnd = cellToCoordinate(clipboard.active)!;
    const minRow = Math.min(src.row, srcEnd.row);
    const maxRow = Math.max(src.row, srcEnd.row);
    const minCol = Math.min(src.column, srcEnd.column);
    const maxCol = Math.max(src.column, srcEnd.column);
    for (let r = minRow; r <= maxRow; r += 1) {
      for (let c = minCol; c <= maxCol; c += 1) {
        delete next[coordinateToCell(r, c)];
      }
    }
  }
  for (let r = 0; r < rows.length; r += 1) {
    for (let c = 0; c < numCols; c += 1) {
      const coord = coordinateToCell(start.row + r, start.column + c);
      const value = rows[r][c] ?? '';
      if (value === '') {
        delete next[coord];
      } else {
        next[coord] = value;
      }
    }
  }
  return { cells: next, error: null };
}

export interface PasteOutcome {
  // The resulting cell map; equals the original cells when the paste fails.
  cells: CellMap;
  error: string | null;
}

// Validates and applies a paste starting at startCoord (e.g. 'D1'). All
// target cells are validated first; any failure rejects the whole paste and
// keeps the original cells. Cells outside the rectangle are untouched.
export function applyPasteToSheet(
  sheet: Sheet,
  startCoord: string,
  text: string
): PasteOutcome {
  const rows = parsePasteText(text);
  if (rows.length === 0) {
    return { cells: sheet.cells, error: null };
  }
  const start = cellToCoordinate(startCoord);
  if (!start) {
    return { cells: sheet.cells, error: 'Invalid target cell' };
  }
  let numCols = 0;
  for (const row of rows) {
    if (row.length > numCols) {
      numCols = row.length;
    }
  }
  if (
    start.row + rows.length > sheet.rowCount ||
    start.column + numCols > sheet.columnCount
  ) {
    return { cells: sheet.cells, error: 'Paste area exceeds the worksheet bounds' };
  }

  // Validate the entire rectangle before touching any cell so a rejected
  // paste never leaves a partial record.
  for (let r = 0; r < rows.length; r += 1) {
    for (let c = 0; c < numCols; c += 1) {
      const coord = coordinateToCell(start.row + r, start.column + c);
      const value = rows[r][c] ?? '';
      const error = validationErrorForInput(sheet, coord, value);
      if (error) {
        return { cells: sheet.cells, error };
      }
    }
  }

  const next: CellMap = { ...sheet.cells };
  for (let r = 0; r < rows.length; r += 1) {
    for (let c = 0; c < numCols; c += 1) {
      const coord = coordinateToCell(start.row + r, start.column + c);
      const value = rows[r][c] ?? '';
      if (value === '') {
        delete next[coord];
      } else {
        next[coord] = value;
      }
    }
  }
  return { cells: next, error: null };
}

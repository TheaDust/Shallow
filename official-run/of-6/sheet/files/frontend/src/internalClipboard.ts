import type { Sheet } from './types';
import { cellToCoordinate, coordinateToCell } from './gridUtils';

// In-application clipboard for REQ-3-2-1 copy/cut/paste of rectangular cell
// ranges within the current active worksheet. The clipboard stores the raw
// values (formulas verbatim) of the source rectangle so a later paste can
// translate relative formula references by the target offset while absolute
// references stay unchanged. Only transfers inside the same worksheet are
// supported: pasting ignores an internal clipboard that belongs to another
// worksheet.

export type ClipboardKind = 'copy' | 'cut';

export interface InternalClipboard {
  sheetId: string;
  kind: ClipboardKind;
  // Normalized rectangle corners (anchor = top-left, active = bottom-right).
  anchor: string;
  active: string;
  // Raw cell values/formulas in the source rectangle's 2D layout.
  rows: string[][];
}

let clipboard: InternalClipboard | null = null;

export function setInternalClipboard(value: InternalClipboard | null): void {
  clipboard = value;
}

export function getInternalClipboard(): InternalClipboard | null {
  return clipboard;
}

// Reads the rectangle spanned by two corners into a 2D grid of raw values.
// Also returns the normalized corners so the paste offset can be computed
// reliably regardless of which corner the user dragged first.
export function clipboardRowsForSheet(
  sheet: Sheet,
  cornerA: string,
  cornerB: string
): { rows: string[][]; topLeft: string; bottomRight: string } {
  const a = cellToCoordinate(cornerA);
  const b = cellToCoordinate(cornerB);
  if (!a || !b) {
    return { rows: [], topLeft: cornerA, bottomRight: cornerB };
  }
  const minRow = Math.min(a.row, b.row);
  const maxRow = Math.max(a.row, b.row);
  const minCol = Math.min(a.column, b.column);
  const maxCol = Math.max(a.column, b.column);
  const rows: string[][] = [];
  for (let r = minRow; r <= maxRow; r += 1) {
    const row: string[] = [];
    for (let c = minCol; c <= maxCol; c += 1) {
      row.push(sheet.cells[coordinateToCell(r, c)] ?? '');
    }
    rows.push(row);
  }
  return {
    rows,
    topLeft: coordinateToCell(minRow, minCol),
    bottomRight: coordinateToCell(maxRow, maxCol),
  };
}

// Serializes a 2D grid to tab/newline text for the OS clipboard.
export function clipboardTextForRows(rows: string[][]): string {
  return rows.map((row) => row.join('\t')).join('\n');
}

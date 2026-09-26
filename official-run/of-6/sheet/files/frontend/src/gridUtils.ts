export function formatLastUpdated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

export function coordinateToCell(row: number, column: number): string {
  return `${columnLetter(column)}${row + 1}`;
}

export function cellToCoordinate(cell: string): { row: number; column: number } | null {
  const match = /^([A-Z]+)([0-9]+)$/.exec(cell);
  if (!match) {
    return null;
  }
  let col = 0;
  for (let i = 0; i < match[1].length; i += 1) {
    col = col * 26 + (match[1].charCodeAt(i) - 64);
  }
  return { row: Number(match[2]) - 1, column: col - 1 };
}

export interface CoordChange {
  insertRow?: number;
  deleteRow?: number;
  insertColumn?: number;
  deleteColumn?: number;
}

// Shifts a cell coordinate to follow a row/column insertion or deletion.
// Returns null when the coordinate lies on the deleted row/column (the
// caller decides how to fall back).
export function shiftCoord(coord: string, change: CoordChange): string | null {
  const c = cellToCoordinate(coord);
  if (!c) {
    return coord;
  }
  let row = c.row;
  let column = c.column;
  if (typeof change.insertRow === 'number' && row >= change.insertRow) {
    row += 1;
  }
  if (typeof change.deleteRow === 'number') {
    if (row === change.deleteRow) {
      return null;
    }
    if (row > change.deleteRow) {
      row -= 1;
    }
  }
  if (typeof change.insertColumn === 'number' && column >= change.insertColumn) {
    column += 1;
  }
  if (typeof change.deleteColumn === 'number') {
    if (column === change.deleteColumn) {
      return null;
    }
    if (column > change.deleteColumn) {
      column -= 1;
    }
  }
  return coordinateToCell(row, column);
}



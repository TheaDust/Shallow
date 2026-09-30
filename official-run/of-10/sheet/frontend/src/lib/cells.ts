export interface CellAddress {
  row: number;
  column: number;
}

export interface CellRegion {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function columnIndexToLabel(column: number): string {
  let remaining = Math.trunc(column);
  if (!Number.isFinite(remaining) || remaining < 1) return "";
  let label = "";
  while (remaining > 0) {
    const remainder = (remaining - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return label;
}

export function columnLabelToIndex(label: string): number {
  const upper = String(label ?? "").toUpperCase();
  if (upper.length === 0) return -1;
  let index = 0;
  for (const character of upper) {
    const code = character.charCodeAt(0);
    if (code < 65 || code > 90) return -1;
    index = index * 26 + (code - 64);
  }
  return index;
}

export function makeCellId(row: number, column: number): string {
  return `${columnIndexToLabel(column)}${row}`;
}

export function parseCellId(cellId: string): CellAddress | null {
  const match = /^([A-Za-z]{1,3})([1-9][0-9]{0,6})$/.exec(String(cellId ?? "").trim());
  if (!match) return null;
  const column = columnLabelToIndex(match[1]);
  if (column < 1) return null;
  return { row: Number(match[2]), column };
}

export const A1: CellAddress = { row: 1, column: 1 };

export function clampCell(address: CellAddress, rowCount: number, columnCount: number): CellAddress {
  return {
    row: Math.min(Math.max(address.row, 1), Math.max(rowCount, 1)),
    column: Math.min(Math.max(address.column, 1), Math.max(columnCount, 1)),
  };
}

export function regionOf(anchor: CellAddress, focus: CellAddress): CellRegion {
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.column, focus.column),
    right: Math.max(anchor.column, focus.column),
  };
}

export function isInRegion(region: CellRegion, address: CellAddress): boolean {
  return (
    address.row >= region.top &&
    address.row <= region.bottom &&
    address.column >= region.left &&
    address.column <= region.right
  );
}

/** The `A1:B2` reference of a rectangle; a single cell keeps its bare coordinate. */
export function regionToRef(region: CellRegion): string {
  const start = makeCellId(region.top, region.left);
  const end = makeCellId(region.bottom, region.right);
  return start === end ? start : `${start}:${end}`;
}

export function range(from: number, to: number): number[] {
  const values: number[] = [];
  for (let value = from; value <= to; value += 1) values.push(value);
  return values;
}

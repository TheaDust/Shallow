/** Grid coordinate helpers. Rows and columns are 1-based, coordinates use A1 notation. */

export interface CellPosition {
  row: number;
  column: number;
}

export interface CellRegion {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export function columnName(column: number): string {
  let value = Math.max(1, Math.trunc(column));
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

export function cellName(row: number, column: number): string {
  return `${columnName(column)}${row}`;
}

export function parseCellName(coordinate: string): CellPosition | null {
  const match = /^([A-Za-z]+)([1-9][0-9]*)$/.exec(coordinate.trim());
  if (!match) return null;
  const letters = match[1].toUpperCase();
  let column = 0;
  for (const letter of letters) {
    column = column * 26 + (letter.charCodeAt(0) - 64);
  }
  return { row: Number(match[2]), column };
}

/** Rectangular region spanned by an anchor cell and the current focus cell. */
export function regionBetween(anchor: string, focus: string): CellRegion {
  const a = parseCellName(anchor) ?? { row: 1, column: 1 };
  const b = parseCellName(focus) ?? a;
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.column, b.column),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.column, b.column),
  };
}

/** Parses an A1 area such as `A1:B2` or `A1` into a rectangle, or `null`. */
export function regionFromArea(area: string): CellRegion | null {
  const [start, end = start] = String(area ?? "").trim().split(":");
  const first = parseCellName(start);
  const last = parseCellName(end);
  if (!first || !last) return null;
  return {
    top: Math.min(first.row, last.row),
    bottom: Math.max(first.row, last.row),
    left: Math.min(first.column, last.column),
    right: Math.max(first.column, last.column),
  };
}

export function isInsideRegion(row: number, column: number, region: CellRegion): boolean {
  return row >= region.top && row <= region.bottom && column >= region.left && column <= region.right;
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatLastUpdated(iso: string): string {
  return `Last updated: ${formatTimestamp(iso)}`;
}

export interface CellPosition {
  /** 1-based row number */
  row: number;
  /** 0-based column index */
  col: number;
}

export function columnName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

export function cellName(row: number, col: number): string {
  return `${columnName(col)}${row}`;
}

export function parseCoord(coord: string): CellPosition | null {
  const match = /^([A-Z]+)([1-9]\d*)$/.exec(coord);
  if (!match) return null;
  let col = 0;
  for (const ch of match[1]) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return { row: Number(match[2]), col: col - 1 };
}

export const DEFAULT_GRID_ROWS = 50;
export const DEFAULT_GRID_COLS = 26;

export interface GridSize {
  rows: number;
  cols: number;
}

export function gridSize(cells: Record<string, string>): GridSize {
  let maxRow = 1;
  let maxCol = 0;
  for (const coord of Object.keys(cells)) {
    const position = parseCoord(coord);
    if (!position) continue;
    maxRow = Math.max(maxRow, position.row);
    maxCol = Math.max(maxCol, position.col);
  }
  return {
    rows: Math.max(DEFAULT_GRID_ROWS, maxRow),
    cols: Math.max(DEFAULT_GRID_COLS, maxCol + 1),
  };
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export interface CellRange {
  start: string;
  end: string;
}

/** Normalize a range so start is the top-left corner and end the bottom-right. */
export function normalizeRange(start: string, end: string): CellRange {
  const from = parseCoord(start);
  const to = parseCoord(end);
  if (!from || !to) return { start, end };
  const rowMin = Math.min(from.row, to.row);
  const rowMax = Math.max(from.row, to.row);
  const colMin = Math.min(from.col, to.col);
  const colMax = Math.max(from.col, to.col);
  return {
    start: cellName(rowMin, colMin),
    end: cellName(rowMax, colMax),
  };
}

/** Whether a coordinate lies inside the rectangle (inclusive). */
export function rangeContains(coord: string, range: CellRange): boolean {
  const position = parseCoord(coord);
  const from = parseCoord(range.start);
  const to = parseCoord(range.end);
  if (!position || !from || !to) return false;
  const rowMin = Math.min(from.row, to.row);
  const rowMax = Math.max(from.row, to.row);
  const colMin = Math.min(from.col, to.col);
  const colMax = Math.max(from.col, to.col);
  return (
    position.row >= rowMin &&
    position.row <= rowMax &&
    position.col >= colMin &&
    position.col <= colMax
  );
}

/** 0-based column indices covered by a range (top-left..bottom-right). */
export function rangeColumns(range: CellRange): number[] {
  const from = parseCoord(range.start);
  const to = parseCoord(range.end);
  if (!from || !to) return [];
  const colMin = Math.min(from.col, to.col);
  const colMax = Math.max(from.col, to.col);
  const columns: number[] = [];
  for (let col = colMin; col <= colMax; col += 1) columns.push(col);
  return columns;
}

/** The top-left row number of a range (the header row when present). */
export function rangeTopRow(range: CellRange): number {
  const from = parseCoord(range.start);
  const to = parseCoord(range.end);
  if (!from || !to) return 1;
  return Math.min(from.row, to.row);
}

/**
 * Parse external clipboard text into a two-dimensional table: newline-separated
 * rows, tab-separated columns. Empty fields are preserved; a single trailing
 * newline does not create an extra empty row.
 */
export function parsePasteText(text: string): string[][] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => line.split("\t"));
}

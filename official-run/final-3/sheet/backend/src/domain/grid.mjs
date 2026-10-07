/** A1-style grid coordinates (1-based rows and columns). Mirrors the frontend helpers. */

export function columnName(column) {
  let value = Math.max(1, Math.trunc(column));
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

export function cellName(row, column) {
  return `${columnName(column)}${row}`;
}

/** Parses an A1 coordinate, returning `{ row, column }` or `null` when malformed. */
export function parseCellName(coordinate) {
  if (typeof coordinate !== "string") return null;
  const match = /^([A-Za-z]+)([1-9][0-9]*)$/.exec(coordinate.trim());
  if (!match) return null;
  let column = 0;
  for (const letter of match[1].toUpperCase()) {
    column = column * 26 + (letter.charCodeAt(0) - 64);
  }
  return { row: Number(match[2]), column };
}

/**
 * Bounds `{ top, left, bottom, right }` of an A1 area such as `A1:B2` or `A1`,
 * or `null` when the area is malformed. Rows/columns are 1-based and the
 * bounds are normalised, so `B2:A1` behaves like `A1:B2`.
 */
export function parseArea(value) {
  if (typeof value !== "string") return null;
  const [start, end = start] = value.trim().split(":");
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

/** Maps a matrix of text values (row-major) onto an A1-keyed cell map. */
export function cellsFromRows(rows) {
  const cells = {};
  rows.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      cells[cellName(rowIndex + 1, columnIndex + 1)] = String(value);
    });
  });
  return cells;
}

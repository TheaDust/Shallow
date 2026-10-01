/**
 * A1 coordinate helpers shared by the grid, CSV import and structure operations.
 * Addresses are always uppercase-first column letters followed by a 1-based row number.
 */

export function columnName(column) {
  let value = column + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

export function cellAddress(row, column) {
  return `${columnName(column)}${row + 1}`;
}

/**
 * Bounds of an A1 rectangle (`A1:C4`, or the single cell `B2`), or null when the text is not a
 * usable range. Columns and rows are returned in order, so the two corners may be submitted in
 * any direction; used by the range commands (sorting) that act on one selected rectangle.
 * @returns {{ top: number, bottom: number, left: number, right: number } | null} zero-based bounds
 */
export function rangeBounds(range) {
  const match = /^([A-Za-z]+)([1-9]\d*)(?::([A-Za-z]+)([1-9]\d*))?$/.exec(String(range ?? "").trim());
  if (!match) return null;
  const from = parseAddress(`${match[1]}${match[2]}`);
  const to = parseAddress(`${match[3] ?? match[1]}${match[4] ?? match[2]}`);
  return {
    top: Math.min(from.row, to.row),
    bottom: Math.max(from.row, to.row),
    left: Math.min(from.column, to.column),
    right: Math.max(from.column, to.column),
  };
}

/** @returns {{ row: number, column: number } | null} zero-based position, or null when invalid. */
export function parseAddress(address) {
  if (typeof address !== "string") return null;
  const match = /^([A-Za-z]+)([1-9]\d*)$/.exec(address.trim());
  if (!match) return null;
  const letters = match[1].toUpperCase();
  let column = 0;
  for (const letter of letters) {
    column = column * 26 + (letter.charCodeAt(0) - 64);
  }
  return { row: Number(match[2]) - 1, column: column - 1 };
}

/**
 * A1-style grid coordinates shared by the workbook domain and the row/column
 * structure operations. Rows and columns are stored 0-based; cell names use a
 * 1-based row number and an uppercase column label (`A1`, `B12`, `AA3`).
 */
export function parseCellName(name) {
  const match = /^([A-Z]{1,3})([1-9][0-9]*)$/.exec(String(name ?? "").trim().toUpperCase());
  if (!match) return null;
  let col = 0;
  for (const character of match[1]) col = col * 26 + (character.charCodeAt(0) - 64);
  return { row: Number(match[2]) - 1, col: col - 1 };
}

export function columnName(col) {
  let label = "";
  let value = col;
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

export function toCellName(row, col) {
  return `${columnName(col)}${row + 1}`;
}

/** Bounding box (in counts) of the non-empty cells of a sparse cell map. */
export function contentExtent(cells) {
  let rows = 0;
  let cols = 0;
  for (const [name, value] of Object.entries(cells ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    const ref = parseCellName(name);
    if (!ref) continue;
    rows = Math.max(rows, ref.row + 1);
    cols = Math.max(cols, ref.col + 1);
  }
  return { rows, cols };
}

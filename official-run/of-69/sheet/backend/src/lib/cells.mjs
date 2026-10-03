const COLUMN_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** 0-based column index to spreadsheet label: 0 -> A, 25 -> Z, 26 -> AA. */
export function columnLabel(column) {
  let index = column;
  let label = "";
  do {
    label = COLUMN_LETTERS[index % 26] + label;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);
  return label;
}

/** 0-based row/column to a cell coordinate such as `A1`. */
export function cellName(row, column) {
  return `${columnLabel(column)}${row + 1}`;
}

/** Parses a cell coordinate such as `A1` into 0-based row/column, or null when invalid. */
export function parseCellName(name) {
  const match = /^([A-Za-z]+)([1-9][0-9]*)$/.exec(String(name ?? "").trim());
  if (!match) return null;
  let column = 0;
  for (const character of match[1].toUpperCase()) {
    column = column * 26 + (character.charCodeAt(0) - 64);
  }
  return { row: Number(match[2]) - 1, column: column - 1 };
}

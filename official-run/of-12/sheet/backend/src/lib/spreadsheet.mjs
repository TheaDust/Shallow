export const DEFAULT_ROW_COUNT = 30;
export const DEFAULT_COLUMN_COUNT = 26;

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function columnLabel(index) {
  if (!Number.isInteger(index) || index < 0) throw new Error(`Invalid column index: ${index}`);
  let remaining = index;
  let label = "";
  do {
    label = LETTERS[remaining % 26] + label;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return label;
}

export function columnIndex(label) {
  if (typeof label !== "string" || !/^[A-Z]+$/.test(label)) return -1;
  let index = 0;
  for (const letter of label) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

export function isCellCoordinate(value) {
  return typeof value === "string" && /^[A-Z]+[1-9][0-9]*$/.test(value);
}

export function parseCellCoordinate(value) {
  if (!isCellCoordinate(value)) return null;
  const match = /^([A-Z]+)([1-9][0-9]*)$/.exec(value);
  return { column: columnIndex(match[1]), row: Number(match[2]) - 1 };
}

export function cellCoordinate(row, column) {
  return `${columnLabel(column)}${row + 1}`;
}

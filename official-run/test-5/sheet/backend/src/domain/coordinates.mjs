/** Spreadsheet coordinate helpers shared by the workbook domain modules. */

export function columnLabel(column) {
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

export function cellAddress(column, row) {
  return `${columnLabel(column)}${row}`;
}

export function parseCellAddress(address) {
  const match = /^([A-Za-z]+)([0-9]+)$/.exec(String(address ?? "").trim());
  if (!match) return null;
  const letters = match[1].toUpperCase();
  let column = 0;
  for (const letter of letters) column = column * 26 + (letter.charCodeAt(0) - 64);
  const row = Number(match[2]);
  if (!Number.isInteger(row) || row < 1 || column < 1) return null;
  return { column, row };
}

export function isValidCellAddress(address) {
  return parseCellAddress(address) !== null;
}

export const DEFAULT_ROW_COUNT = 50;
export const DEFAULT_COLUMN_COUNT = 26;

/** Largest address the formula engine accepts; a reference beyond it is invalid (#REF!). */
export const MAX_ROW_INDEX = 1_048_576;
export const MAX_COLUMN_INDEX = 16_384;

export function columnIndexToLabel(column) {
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

export function columnLabelToIndex(label) {
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

export function makeCellId(row, column) {
  return `${columnIndexToLabel(column)}${row}`;
}

export function parseCellId(cellId) {
  const match = /^([A-Za-z]{1,3})([1-9][0-9]{0,6})$/.exec(String(cellId ?? "").trim());
  if (!match) return null;
  const column = columnLabelToIndex(match[1]);
  if (column < 1) return null;
  return { row: Number(match[2]), column };
}

export function isAddressInBounds(address) {
  return (
    Number.isInteger(address?.row) &&
    Number.isInteger(address?.column) &&
    address.row >= 1 &&
    address.row <= MAX_ROW_INDEX &&
    address.column >= 1 &&
    address.column <= MAX_COLUMN_INDEX
  );
}

/** Parses `A1` or `A1:C4` into a normalized rectangle, or null when the reference is malformed. */
export function parseRangeRef(text) {
  const parts = String(text ?? "").trim().split(":");
  if (parts.length > 2) return null;
  const start = parseCellId(parts[0]);
  if (!start) return null;
  const end = parts.length === 2 ? parseCellId(parts[1]) : start;
  if (!end) return null;
  return {
    top: Math.min(start.row, end.row),
    bottom: Math.max(start.row, end.row),
    left: Math.min(start.column, end.column),
    right: Math.max(start.column, end.column),
  };
}

/** Parses an `A1:B2` reference or a `{ top, bottom, left, right }` rectangle into the same shape. */
export function parseRegionRef(value) {
  if (typeof value === "string") return parseRangeRef(value);
  if (value && typeof value === "object") return readRegion(value);
  return null;
}

export function regionHasCell(region, address) {
  return (
    Boolean(region) &&
    address.row >= region.top &&
    address.row <= region.bottom &&
    address.column >= region.left &&
    address.column <= region.right
  );
}

/** Normalizes a rectangle into top/bottom/left/right form, or null when it is malformed. */
export function readRegion(value) {
  const top = Number(value?.top);
  const bottom = Number(value?.bottom);
  const left = Number(value?.left);
  const right = Number(value?.right);
  if (![top, bottom, left, right].every(Number.isInteger)) return null;
  if (top < 1 || left < 1 || bottom < top || right < left) return null;
  return { top, bottom, left, right };
}

/** Keeps every edge of a rectangle inside the worksheet bounds. */
export function clampRegion(region, rowCount, columnCount) {
  return {
    top: Math.min(Math.max(region.top, 1), Math.max(rowCount, 1)),
    bottom: Math.min(Math.max(region.bottom, 1), Math.max(rowCount, 1)),
    left: Math.min(Math.max(region.left, 1), Math.max(columnCount, 1)),
    right: Math.min(Math.max(region.right, 1), Math.max(columnCount, 1)),
  };
}

export function clampAddress(address, rowCount, columnCount) {
  return {
    row: Math.min(Math.max(address.row, 1), Math.max(rowCount, 1)),
    column: Math.min(Math.max(address.column, 1), Math.max(columnCount, 1)),
  };
}

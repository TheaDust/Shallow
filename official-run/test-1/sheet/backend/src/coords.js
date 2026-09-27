/** Spreadsheet coordinate helpers (backend mirror of frontend/src/coords.ts). */

/** 1-based column index -> label (0 -> "A", 25 -> "Z", 26 -> "AA"). */
export function columnLabel(index) {
  let n = index + 1;
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

/** Column (0-based) and row (0-based) -> "A1"-style coordinate. */
export function cellCoordinate(col, row) {
  return `${columnLabel(col)}${row + 1}`;
}

/** Column label -> 1-based number ("A" -> 1, "AA" -> 27). */
export function columnNumber(label) {
  let v = 0;
  for (const ch of String(label)) v = v * 26 + (ch.charCodeAt(0) - 64);
  return v;
}

/** Spreadsheet coordinate helpers shared by grid, CSV import/export and tests. */

/** 0-based column index -> label (0 -> "A", 25 -> "Z", 26 -> "AA"). */
export function columnLabel(index: number): string {
  let n = index + 1;
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

/** Column label -> 1-based number ("A" -> 1, "AA" -> 27). */
export function columnNumber(label: string): number {
  let v = 0;
  for (const ch of label) v = v * 26 + (ch.charCodeAt(0) - 64);
  return v;
}

/** Column (0-based) and row (0-based) -> "A1"-style coordinate. */
export function cellCoordinate(col: number, row: number): string {
  return `${columnLabel(col)}${row + 1}`;
}

/** True when coord lies inside the rectangle spanned by current..end. */
export function isInRegion(coord: string, current: string, end: string): boolean {
  const a = coord.match(/^([A-Z]+)(\d+)$/);
  const b = current.match(/^([A-Z]+)(\d+)$/);
  const c = end.match(/^([A-Z]+)(\d+)$/);
  if (!a || !b || !c) return false;
  const colMin = Math.min(columnNumber(b[1]), columnNumber(c[1]));
  const colMax = Math.max(columnNumber(b[1]), columnNumber(c[1]));
  const rowMin = Math.min(Number(b[2]), Number(c[2]));
  const rowMax = Math.max(Number(b[2]), Number(c[2]));
  return (
    columnNumber(a[1]) >= colMin &&
    columnNumber(a[1]) <= colMax &&
    Number(a[2]) >= rowMin &&
    Number(a[2]) <= rowMax
  );
}

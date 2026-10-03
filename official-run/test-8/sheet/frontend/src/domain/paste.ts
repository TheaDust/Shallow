import { cellCoordinate } from "./grid";

/**
 * External clipboard text for a two-dimensional paste: rows separated by line
 * breaks, columns by tabs. Empty fields are kept so the paste overwrites the
 * whole target rectangle exactly as copied.
 */
export function parseClipboardTable(text: string): string[][] {
  if (typeof text !== "string" || text.length === 0) return [];
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  // A single trailing line break ends the last row; it does not add an empty one.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => line.split("\t"));
}

/** True when the clipboard text holds at least one field to write. */
export function hasClipboardTable(rows: readonly string[][]): boolean {
  return rows.length > 0 && rows.some((row) => row.length > 0);
}

/**
 * The tab/newline text a rectangular range represents, using the values the
 * grid displays so copying a formula cell copies its result. This is what a
 * copy puts on the system clipboard, next to the in-app range marker.
 */
export function clipboardTableText(
  display: Record<string, string>,
  range: { minRow: number; maxRow: number; minCol: number; maxCol: number },
): string {
  const lines: string[] = [];
  for (let row = range.minRow; row <= range.maxRow; row += 1) {
    const line: string[] = [];
    for (let col = range.minCol; col <= range.maxCol; col += 1) {
      line.push(display[cellCoordinate(row, col)] ?? "");
    }
    lines.push(line.join("\t"));
  }
  return lines.join("\n");
}

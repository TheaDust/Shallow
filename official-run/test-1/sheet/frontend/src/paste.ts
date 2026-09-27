import { columnLabel, columnNumber } from "./coords";
import type { WorkbookSelection } from "./types";

/**
 * Paste parsing (REQ-3-1-2), mirror of backend/src/paste.js: clipboard text
 * uses tab-separated columns and newline-separated rows; empty fields inside
 * the rectangle are preserved; a single trailing newline does not produce an
 * extra empty row.
 */
export function parsePasteText(text: string): string[][] {
  const lines = String(text ?? "").split(/\r\n|\r|\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => line.split("\t"));
}

/**
 * The starting cell for a paste: the top-left corner of the current selection
 * rectangle ({current, end}), so pasting into a selected range always begins
 * at its upper-left cell.
 */
export function pasteStartCoord(selection: WorkbookSelection): string {
  const c = /^([A-Z]+)(\d+)$/.exec(selection.current);
  const e = /^([A-Z]+)(\d+)$/.exec(selection.end);
  if (!c || !e) return selection.current;
  const col = Math.min(columnNumber(c[1]), columnNumber(e[1]));
  const row = Math.min(Number(c[2]), Number(e[2]));
  return `${columnLabel(col - 1)}${row}`;
}

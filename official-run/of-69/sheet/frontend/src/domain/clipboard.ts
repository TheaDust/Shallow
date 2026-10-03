import { cellName, parseCellName, type CellInput } from "./types";

/** Splits clipboard text into rows of tab-separated fields; empty fields are preserved. */
export function parseClipboardTable(text: string): string[][] {
  const normalized = String(text ?? "").replace(/\r\n?/g, "\n");
  if (normalized === "") return [];
  const lines = normalized.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const rows = lines.map((line) => line.split("\t"));
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  return rows.map((row) => [...row, ...Array.from({ length: width - row.length }, () => "")]);
}

/**
 * Cell writes for pasting a tab/newline separated table at `startCell`.
 * Returns `null` when there is nothing to paste or the start cell is not a coordinate.
 */
export function clipboardUpdates(text: string, startCell: string): CellInput[] | null {
  const start = parseCellName(startCell);
  if (!start) return null;
  const rows = parseClipboardTable(text);
  if (rows.length === 0) return null;
  const updates: CellInput[] = [];
  rows.forEach((row, rowIndex) => {
    row.forEach((input, columnIndex) => {
      updates.push({ name: cellName(start.row + rowIndex, start.column + columnIndex), input });
    });
  });
  return updates;
}

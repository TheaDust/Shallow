import { cellName, type CellRef } from "./workbook";

/**
 * External clipboard text for REQ-3-1-2: tab-separated columns, newline-separated
 * rows. Empty fields are preserved as empty strings so an empty field inside the
 * pasted rectangle clears its target cell instead of being silently dropped.
 */
export function parseClipboardTable(text: string): string[][] {
  const normalized = String(text ?? "").replace(/\r\n?/g, "\n");
  const withoutTrailingBreak = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  if (withoutTrailingBreak === "") return [];
  return withoutTrailingBreak.split("\n").map((line) => line.split("\t"));
}

/**
 * Cell patch for one paste: every coordinate of the rectangle, with an empty
 * field sent as `null` so the target cell is cleared rather than skipped.
 */
export function tableToCellPatch(
  start: CellRef,
  table: readonly (readonly string[])[],
): Record<string, string | null> {
  const cells: Record<string, string | null> = {};
  table.forEach((row, rowOffset) => {
    row.forEach((value, colOffset) => {
      const name = cellName({ row: start.row + rowOffset, col: start.col + colOffset });
      cells[name] = value === "" ? null : value;
    });
  });
  return cells;
}

import { cellCoordinate, normalizeRange, type SelectionRange } from "./spreadsheet";
import type { CellRange, RangeTransferMode, Worksheet } from "./workbooks";

/**
 * The clipboard of one copied or cut rectangular range. It is kept per editor session (the same
 * range can be pasted repeatedly for a copy, while a cut is consumed by its paste) and mirrors the
 * tab/newline text a spreadsheet puts on the system clipboard, so an in-application paste can be
 * told apart from unrelated external clipboard content.
 */
export interface RangeClipboard {
  worksheetId: string;
  mode: RangeTransferMode;
  range: CellRange;
  text: string;
}

/** `{ start, end }` rectangle of a selection, in the order the range transfer endpoint expects. */
export function selectionRectangle(selection: SelectionRange): CellRange {
  return { start: selection.anchor, end: selection.focus };
}

/** Tab-separated columns and newline-separated rows of the rectangle, read top-left to bottom-right. */
export function rangeClipboardText(worksheet: Worksheet, range: CellRange): string {
  const { minRow, maxRow, minColumn, maxColumn } = normalizeRange({ anchor: range.start, focus: range.end });
  const lines: string[] = [];
  for (let row = minRow; row <= maxRow; row += 1) {
    const fields: string[] = [];
    for (let column = minColumn; column <= maxColumn; column += 1) {
      fields.push(worksheet.cells[cellCoordinate(row, column)] ?? "");
    }
    lines.push(fields.join("\t"));
  }
  return lines.join("\n");
}

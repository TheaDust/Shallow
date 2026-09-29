/**
 * Clipboard state and rectangle helpers of range transfer (REQ-3-2-1).
 *
 * A copy or cut of the active worksheet's selection is remembered here until it
 * is pasted: the rectangle keeps its own worksheet, so a clipboard taken in one
 * worksheet is only applied back inside that same worksheet.
 */

import { cellAddress } from "./coordinates";
import { selectionBounds, type CellSelection } from "./selection";

export type TransferMode = "copy" | "cut";

export const CUT_COMMAND = "cut";
export const COPY_COMMAND = "copy";
export const CUT_COMMAND_LABEL = "Cut";
export const COPY_COMMAND_LABEL = "Copy";

export interface CellRange {
  start: string;
  end: string;
}

/** A rectangle copied or cut inside one worksheet, waiting to be pasted. */
export interface RangeClipboard {
  worksheetId: string;
  mode: TransferMode;
  range: CellRange;
}

/** Rectangle of a selection, as its top-left and bottom-right corners. */
export function selectionRange(selection: CellSelection): CellRange {
  const bounds = selectionBounds(selection);
  return {
    start: cellAddress(bounds.leftColumn, bounds.topRow),
    end: cellAddress(bounds.rightColumn, bounds.bottomRow),
  };
}

/**
 * Clipboard text of a rectangle: rows separated by newlines, columns by tabs,
 * the raw text of each cell (a formula keeps its original text).
 */
export function rangeToText(
  cells: Readonly<Record<string, string>>,
  range: CellRange,
): string {
  const bounds = selectionBounds({ anchor: range.start, focus: range.end });
  const rows: string[] = [];
  for (let row = bounds.topRow; row <= bounds.bottomRow; row += 1) {
    const fields: string[] = [];
    for (let column = bounds.leftColumn; column <= bounds.rightColumn; column += 1) {
      fields.push(cells[cellAddress(column, row)] ?? "");
    }
    rows.push(fields.join("\t"));
  }
  return rows.join("\n");
}

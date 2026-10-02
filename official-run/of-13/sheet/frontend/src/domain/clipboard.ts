/**
 * The in-app range clipboard used by copy/cut and paste.
 *
 * A copied or cut range keeps the raw text of its cells (so a copied formula can be
 * re-translated for the target offset) together with the tab-separated text written to the
 * system clipboard. Pasting uses this range clipboard when the text offered by the browser
 * is the same text (or when the browser offers none, e.g. without a clipboard permission),
 * and otherwise treats the text as external tab-separated data.
 */

import { cellAddress, parseAddress, selectionBounds, type CellSelection } from "./spreadsheet";
import { cellInput, type WorksheetState } from "./workbook";

export type RangeTransferMode = "copy" | "cut";

export interface RangeClipboard {
  sheetId: string;
  /** Rectangle the values were copied or cut from. */
  source: CellSelection;
  mode: RangeTransferMode;
  /** Raw text of the rectangle in grid order; a formula keeps its submitted text. */
  rows: string[][];
  /** The rectangle as tab-separated text: what the system clipboard receives. */
  text: string;
}

/** Raw text of the selected rectangle, row by row, in grid order. */
export function selectionRows(
  sheet: WorksheetState | undefined,
  selection: CellSelection,
): string[][] {
  const bounds = selectionBounds(selection);
  const rows: string[][] = [];
  for (let row = bounds.top; row <= bounds.bottom; row += 1) {
    const line: string[] = [];
    for (let column = bounds.left; column <= bounds.right; column += 1) {
      line.push(cellInput(sheet, cellAddress(row, column)));
    }
    rows.push(line);
  }
  return rows;
}

/** Text of the copied rectangle as the system clipboard receives it. */
export function rangeClipboardText(rows: readonly string[][]): string {
  return rows.map((line) => line.join("\t")).join("\n");
}

export function buildRangeClipboard(
  sheet: WorksheetState | undefined,
  selection: CellSelection,
  mode: RangeTransferMode,
): RangeClipboard | null {
  if (!sheet) return null;
  const rows = selectionRows(sheet, selection);
  return {
    sheetId: sheet.id,
    source: { start: selection.start, end: selection.end },
    mode,
    rows,
    text: rangeClipboardText(rows),
  };
}

/** True when clipboard text is the copied range itself, so the move keeps its formulas. */
export function isRangeClipboardText(clipboard: RangeClipboard | null, text: string): boolean {
  if (!clipboard) return false;
  if (text.trim() === "") return true;
  return text.replace(/\r\n?/g, "\n") === clipboard.text;
}

/** Target rectangle of a paste: the address a command was triggered from, or the selection. */
export function targetSelectionFor(address: string, selection: CellSelection): CellSelection {
  const inside = (() => {
    const position = parseAddress(address);
    if (!position) return false;
    const bounds = selectionBounds(selection);
    return (
      position.row >= bounds.top &&
      position.row <= bounds.bottom &&
      position.column >= bounds.left &&
      position.column <= bounds.right
    );
  })();
  return inside ? { start: selection.start, end: selection.end } : { start: address, end: address };
}

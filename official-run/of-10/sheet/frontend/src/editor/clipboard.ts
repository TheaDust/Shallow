import { makeCellId, type CellRegion } from "../lib/cells";
import { rawCellText } from "../workbooks/cells";
import type { WorksheetData } from "../workbooks/types";

/**
 * Parses text copied from another application into the rectangle it describes: tab separated
 * columns, newline separated rows. Empty fields are kept as empty strings so a paste can clear the
 * cells it covers; one trailing line break is treated as the end of the last row rather than as an
 * extra empty row.
 */
export function parseClipboardTable(text: string): string[][] {
  if (typeof text !== "string") return [];
  let normalized = text.replace(/\r\n?/g, "\n");
  if (normalized.endsWith("\n")) normalized = normalized.slice(0, -1);
  if (normalized === "") return [];
  return normalized.split("\n").map((line) => line.split("\t"));
}

/** How a range was taken from its worksheet: `copy` keeps the source, `cut` clears it on paste. */
export type RangeClipboardMode = "copy" | "cut";

/** A rectangle taken from one worksheet, waiting for its paste target. */
export interface RangeClipboard {
  worksheetId: string;
  mode: RangeClipboardMode;
  region: CellRegion;
}

/**
 * The tab separated text of a rectangle, using the submitted cell text so formulas keep their
 * original expression. It is what the grid puts on the system clipboard next to the internal one.
 */
export function rangeToTsv(worksheet: WorksheetData | undefined, region: CellRegion): string {
  const lines: string[] = [];
  for (let row = region.top; row <= region.bottom; row += 1) {
    const fields: string[] = [];
    for (let column = region.left; column <= region.right; column += 1) {
      fields.push(rawCellText(worksheet, makeCellId(row, column)));
    }
    lines.push(fields.join("\t"));
  }
  return lines.join("\n");
}

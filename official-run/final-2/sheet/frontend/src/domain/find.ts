/**
 * Find and replace over the active worksheet.
 *
 * A cell matches when its *entire displayed value* equals the Find text: the
 * grid value of a formula cell (its calculated result) is what a viewer reads,
 * so a formula whose result equals the text matches like a plain text cell.
 * Comparison ignores letter case unless "Match case" is checked. Matches are
 * listed in reading order (left to right, top to bottom), which is the order
 * "Find next" walks through them.
 */

import { computeDisplayValues, type CellValues } from "./formula";
import { cellName, parseCellName } from "./grid";

/** One matching cell: its coordinate and 1-based grid position. */
export interface CellMatch {
  coordinate: string;
  row: number;
  column: number;
}

/** Every cell whose displayed value equals `findText`, in reading order. */
export function findMatches(cells: CellValues, findText: string, matchCase: boolean): CellMatch[] {
  if (findText === "") return [];
  const wanted = matchCase ? findText : findText.toLowerCase();
  const values = computeDisplayValues(cells);
  const matches: CellMatch[] = [];
  for (const [coordinate, text] of Object.entries(values)) {
    const position = parseCellName(coordinate);
    if (!position) continue;
    const candidate = matchCase ? text : text.toLowerCase();
    if (candidate !== wanted) continue;
    matches.push({ coordinate: cellName(position.row, position.column), row: position.row, column: position.column });
  }
  matches.sort((left, right) => left.row - right.row || left.column - right.column);
  return matches;
}

/**
 * Index of the match "Find next" selects from `from`: the first match after the
 * current position in reading order, wrapping around to the first one when the
 * search reaches the end of the sheet.
 */
export function nextMatchIndex(matches: readonly CellMatch[], from: string): number {
  const position = parseCellName(from);
  if (!position) return 0;
  const index = matches.findIndex(
    (match) => match.row > position.row || (match.row === position.row && match.column > position.column),
  );
  return index === -1 ? 0 : index;
}

/** Status line of a "Find next": the reached match and how many exist. */
export function matchStatus(current: number, total: number): string {
  return `Match ${current} of ${total}`;
}

/** Status line of a "Replace all". */
export function replacedStatus(count: number): string {
  return `Replaced ${count} cells`;
}

/** Status line shown while the Find text matches no cell of the worksheet. */
export const NO_MATCHES_MESSAGE = "No matches";

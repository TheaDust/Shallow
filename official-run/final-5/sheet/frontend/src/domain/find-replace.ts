/**
 * Pure helpers of the find-and-replace dialog.
 *
 * A cell matches when its entire *displayed* value equals the Find text: with
 * "Match case" unchecked the comparison ignores letter case, with it checked
 * the comparison is case-sensitive. Matches are ordered row by row, left to
 * right, which is the order "Find next" walks through.
 */

import type { CellValues } from "./formula";
import { cellName, parseCellName } from "./grid";

/** Search request shared by "Find next" and "Replace all". */
export interface FindRequest {
  /** Text the whole displayed value of a cell has to equal. */
  find: string;
  /** Case-sensitive comparison when true, case-insensitive when false. */
  matchCase: boolean;
}

/** "Replace all" also carries the replacement text written into every match. */
export interface ReplaceRequest extends FindRequest {
  replaceWith: string;
}

/** Row-major coordinates of the cells matching `find`; an empty query matches none. */
export function findMatches(values: CellValues, find: string, matchCase: boolean): string[] {
  if (find === "") return [];
  const wanted = matchCase ? find : find.toLowerCase();
  const matches: Array<{ row: number; column: number; coordinate: string }> = [];
  for (const [coordinate, value] of Object.entries(values)) {
    const position = parseCellName(coordinate);
    if (!position) continue;
    const text = matchCase ? value : value.toLowerCase();
    if (text !== wanted) continue;
    matches.push({ row: position.row, column: position.column, coordinate: cellName(position.row, position.column) });
  }
  matches.sort((left, right) => (left.row === right.row ? left.column - right.column : left.row - right.row));
  return matches.map((match) => match.coordinate);
}

/**
 * Index of the first match strictly after `after` in row-major order, wrapping
 * around to the first match at the end. `-1` when there is no match at all.
 */
export function nextMatchIndex(matches: readonly string[], after: string): number {
  if (matches.length === 0) return -1;
  const start = parseCellName(after) ?? { row: 1, column: 1 };
  const index = matches.findIndex((coordinate) => {
    const position = parseCellName(coordinate);
    if (!position) return false;
    return position.row > start.row || (position.row === start.row && position.column > start.column);
  });
  return index === -1 ? 0 : index;
}

/** Message shown after "Find next": the position of the selected match. */
export function matchMessage(current: number, total: number): string {
  return `Match ${current} of ${total}`;
}

/** Message shown after "Replace all": how many cells were rewritten. */
export function replacedMessage(count: number): string {
  return `Replaced ${count} cells`;
}

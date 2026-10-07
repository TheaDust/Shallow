/**
 * Find-and-replace matching over the *displayed* values of a worksheet: a cell
 * matches when its entire displayed value equals the search text, so a formula
 * cell is compared through its calculated result and `Cobalt-7` never matches
 * `Cobalt`. Matching is case-insensitive unless `matchCase` is set.
 */

import { parseCellName } from "./grid";

export interface FindOptions {
  /** Compare letter case exactly (the dialog's "Match case" checkbox). */
  matchCase: boolean;
}

/** One cell write produced by a replacement. */
export interface CellUpdate {
  coordinate: string;
  value: string;
}

function compare(first: string, second: string): number {
  const a = parseCellName(first) ?? { row: 0, column: 0 };
  const b = parseCellName(second) ?? { row: 0, column: 0 };
  return a.row - b.row || a.column - b.column;
}

function equals(value: string, wanted: string, matchCase: boolean): boolean {
  return matchCase ? value === wanted : value.toLowerCase() === wanted.toLowerCase();
}

/**
 * Coordinates of every cell whose displayed value equals `query`, in the order
 * the grid reads them (top to bottom, left to right). An empty query matches
 * nothing, so an untouched dialog never replaces blank cells.
 */
export function findMatches(
  display: Record<string, string>,
  query: string,
  options: FindOptions,
): string[] {
  if (query === "") return [];
  const matches = Object.keys(display).filter(
    (coordinate) => parseCellName(coordinate) !== null && equals(display[coordinate] ?? "", query, options.matchCase),
  );
  return matches.sort(compare);
}

/**
 * Index of the first match that comes after `cursor` when reading the grid, or
 * the first match again when the search wraps around the end. `cursor` is the
 * cell the search starts from (the selection when the dialog opens, then the
 * last cell that was found), so a repeated "Find next" walks every match.
 */
export function nextMatchIndex(matches: readonly string[], cursor: string | null): number {
  if (matches.length === 0) return -1;
  if (!cursor || !parseCellName(cursor)) return 0;
  const after = matches.findIndex((coordinate) => compare(coordinate, cursor) > 0);
  return after === -1 ? 0 : after;
}

/**
 * The writes of "Replace all": every matching cell of the worksheet receives
 * `replacement`. Computed before any write, so replacing a cell with the text
 * it already holds cannot feed the search again.
 */
export function replacementUpdates(
  display: Record<string, string>,
  query: string,
  replacement: string,
  options: FindOptions,
): CellUpdate[] {
  return findMatches(display, query, options).map((coordinate) => ({ coordinate, value: replacement }));
}

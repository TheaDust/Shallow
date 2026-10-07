import { cellName, parseCellName } from "./grid";

/** The text of a find, plus whether the comparison is case-sensitive. */
export interface FindQuery {
  find: string;
  matchCase: boolean;
}

/**
 * Whole-cell matching of "Find and replace": a cell matches only when its
 * entire stored text equals the find text, so `Cobalt-7` never matches a
 * search for `Cobalt`. The comparison ignores letter case unless `matchCase`
 * is set. A formula cell keeps its expression, so it is matched (and
 * replaced) by the submitted text rather than by a calculated result; the
 * same rule is applied by the server, so a shown count and the stored change
 * always agree.
 */
export function cellMatches(text: string | undefined, { find, matchCase }: FindQuery): boolean {
  if (typeof text !== "string" || find === "") return false;
  return matchCase ? text === find : text.toLowerCase() === find.toLowerCase();
}

/** Matching cells in row-major order (by row, then by column). */
export function matchCoordinates(cells: Record<string, string>, query: FindQuery): string[] {
  const matches: Array<{ coordinate: string; row: number; column: number }> = [];
  for (const [coordinate, text] of Object.entries(cells ?? {})) {
    const position = parseCellName(coordinate);
    if (!position || !cellMatches(text, query)) continue;
    matches.push({ coordinate: cellName(position.row, position.column), ...position });
  }
  matches.sort((left, right) => (left.row === right.row ? left.column - right.column : left.row - right.row));
  return matches.map((match) => match.coordinate);
}

/**
 * The match that follows `anchor` in row-major order, wrapping around to the
 * first one; `null` when there is no match at all.
 */
export function nextMatchCoordinate(matches: readonly string[], anchor: string): string | null {
  if (matches.length === 0) return null;
  const start = parseCellName(anchor) ?? { row: 0, column: 0 };
  const next = matches.find((coordinate) => {
    const position = parseCellName(coordinate);
    if (!position) return false;
    return position.row > start.row || (position.row === start.row && position.column > start.column);
  });
  return next ?? matches[0];
}

/** 1-based position of a match inside the row-major list, or `0` when unknown. */
export function matchNumber(matches: readonly string[], coordinate: string): number {
  return matches.indexOf(coordinate) + 1;
}

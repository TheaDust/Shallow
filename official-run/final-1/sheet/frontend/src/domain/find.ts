import { cellName, parseCellName, type CellPosition } from "./grid";

/** One cell whose displayed value equals the searched text. */
export interface FindMatch extends CellPosition {
  coordinate: string;
}

/**
 * Cells of `display` whose whole displayed value equals `findText`. A cell
 * matches only on the complete value (`Cobalt-7` does not match `Cobalt`), and
 * the comparison ignores letter case unless `matchCase` is set. Matches come
 * back in grid order (top to bottom, left to right) so "Find next" walks them
 * predictably. An empty search text matches nothing.
 */
export function findMatches(
  display: Record<string, string>,
  findText: string,
  matchCase: boolean,
): FindMatch[] {
  if (findText === "") return [];
  const wanted = matchCase ? findText : findText.toLowerCase();
  const matches: FindMatch[] = [];
  for (const [coordinate, value] of Object.entries(display)) {
    const position = parseCellName(coordinate);
    if (!position) continue;
    const candidate = matchCase ? value : (value ?? "").toLowerCase();
    if (candidate !== wanted) continue;
    matches.push({ coordinate: cellName(position.row, position.column), row: position.row, column: position.column });
  }
  matches.sort((left, right) => left.row - right.row || left.column - right.column);
  return matches;
}

/**
 * Index in `matches` of the first match strictly after `from` in grid order,
 * wrapping around to the first match. `from` is the current selection, so
 * repeated "Find next" presses walk the whole worksheet. Without a position the
 * search starts at the first match; without matches the result is -1.
 */
export function nextMatchIndex(matches: FindMatch[], from: CellPosition | null): number {
  if (matches.length === 0) return -1;
  if (!from) return 0;
  const index = matches.findIndex(
    (match) => match.row > from.row || (match.row === from.row && match.column > from.column),
  );
  return index === -1 ? 0 : index;
}

/** Single-cell writes replacing every match with `replaceText`. */
export function replaceUpdates(matches: FindMatch[], replaceText: string): Array<{ coordinate: string; value: string }> {
  return matches.map((match) => ({ coordinate: match.coordinate, value: replaceText }));
}

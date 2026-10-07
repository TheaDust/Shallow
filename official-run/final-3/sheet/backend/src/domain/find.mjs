import { cellName, parseCellName } from "./grid.mjs";

/**
 * Whole-cell matching of "Find and replace": a cell matches only when its
 * entire stored text equals the find text, so a longer value such as
 * `Cobalt-7` never matches a search for `Cobalt`. The comparison ignores
 * letter case unless `caseSensitive` is set. Formula cells keep their
 * expression, so they are matched by the text the user submitted rather than
 * by a calculated result.
 */
export function cellMatches(text, find, caseSensitive) {
  if (typeof text !== "string" || typeof find !== "string" || find === "") return false;
  return caseSensitive ? text === find : text.toLowerCase() === find.toLowerCase();
}

/**
 * Coordinates of every matching cell of `cells`, in row-major order (by row,
 * then by column), so the order is deterministic for "find next" and for the
 * count of a replacement.
 */
export function matchCoordinates(cells, { find, caseSensitive = false } = {}) {
  const matches = [];
  for (const [coordinate, text] of Object.entries(cells ?? {})) {
    const position = parseCellName(coordinate);
    if (!position || !cellMatches(text, find, caseSensitive)) continue;
    matches.push({ coordinate: cellName(position.row, position.column), row: position.row, column: position.column });
  }
  matches.sort((left, right) => (left.row === right.row ? left.column - right.column : left.row - right.row));
  return matches.map((match) => match.coordinate);
}

/** The replacement write for every matching cell, in the same row-major order. */
export function replacementUpdates(cells, { find, replaceWith, caseSensitive = false } = {}) {
  return matchCoordinates(cells, { find, caseSensitive }).map((coordinate) => ({
    coordinate,
    value: replaceWith,
  }));
}

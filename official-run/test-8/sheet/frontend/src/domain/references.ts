import { columnIndexFromLabel, columnLabel } from "./grid";
import type { CellCoordinate } from "./types";

/**
 * Reference maths shared by the grid and the test double: moving the A1
 * references of a copied formula by the offset between the source range and its
 * target. A `$`-marked column or row stays put; a relative reference the offset
 * would push outside the grid becomes `#REF!`. The backend keeps the same
 * behaviour in `backend/src/domain/formula.mjs`.
 */

export interface GridSize {
  rowCount: number;
  columnCount: number;
}

const REFERENCE_PATTERN = /^(\$?)([A-Za-z]{1,3})(\$?)([0-9]+)/;

function isFormula(raw: string | undefined): boolean {
  return typeof raw === "string" && raw.startsWith("=");
}

/** Matches a cell reference (optionally an A1:B2 range) starting at `start`. */
function matchReferenceAt(text: string, start: number) {
  if (start > 0 && /[A-Za-z0-9_.]/.test(text[start - 1])) return null;
  const leftover = text.slice(start);
  const single = REFERENCE_PATTERN.exec(leftover);
  if (!single) return null;
  let end = start + single[0].length;
  let endpoint: RegExpExecArray | null = null;
  if (text[end] === ":") {
    const after = REFERENCE_PATTERN.exec(text.slice(end + 1));
    if (after) {
      const candidateEnd = end + 1 + after[0].length;
      if (!/[A-Za-z0-9_]/.test(text[candidateEnd] ?? "")) {
        endpoint = after;
        end = candidateEnd;
      }
    }
  }
  // Reject identifiers such as `LOG10(` that only look like a reference.
  if (!endpoint && /[A-Za-z0-9_(]/.test(text[end] ?? "")) return null;
  return { single, endpoint, end };
}

function formatReference(colMarker: string, col: number, rowMarker: string, row: number): string {
  return `${colMarker}${columnLabel(col)}${rowMarker}${row + 1}`;
}

function insideBounds(row: number, col: number, bounds: GridSize): boolean {
  return row >= 0 && col >= 0 && row < bounds.rowCount && col < bounds.columnCount;
}

/** Moves one endpoint of a reference, honouring its `$` absolute markers. */
function offsetEndpoint(
  parts: RegExpExecArray,
  rowDelta: number,
  colDelta: number,
  bounds: GridSize,
) {
  const colMarker = parts[1] ?? "";
  const rowMarker = parts[3] ?? "";
  const col = columnIndexFromLabel(parts[2]);
  const row = Number(parts[4]) - 1;
  const nextCol = colMarker === "$" ? col : col + colDelta;
  const nextRow = rowMarker === "$" ? row : row + rowDelta;
  if (!insideBounds(nextRow, nextCol, bounds)) return null;
  return { colMarker, rowMarker, col: nextCol, row: nextRow };
}

function offsetReference(
  match: { single: RegExpExecArray; endpoint: RegExpExecArray | null },
  rowDelta: number,
  colDelta: number,
  bounds: GridSize,
): string {
  const start = offsetEndpoint(match.single, rowDelta, colDelta, bounds);
  if (!start) return "#REF!";
  const startText = formatReference(start.colMarker, start.col, start.rowMarker, start.row);
  if (!match.endpoint) return startText;
  const end = offsetEndpoint(match.endpoint, rowDelta, colDelta, bounds);
  if (!end) return "#REF!";
  if (start.row > end.row || start.col > end.col) return "#REF!";
  return `${startText}:${formatReference(end.colMarker, end.col, end.rowMarker, end.row)}`;
}

/**
 * Returns `formula` with the rows of its A1 references remapped by `mapRow`:
 * `mapRow(col, row)` receives a reference's zero-based column and row and
 * returns the `{col, row}` it moves to, or null to keep that reference as it
 * is. `$`-marked rows keep their row (like `shiftFormulaByOffset`), range
 * endpoints are remapped together and normalized, and non-formula text is
 * returned unchanged. The sort command uses this so a moved record's formulas
 * keep pointing at the records they referenced before the reorder; the backend
 * keeps the same behaviour in `backend/src/domain/formula.mjs`.
 */
export function mapFormulaRows(
  formula: string,
  mapRow: (col: number, row: number) => CellCoordinate | null,
): string {
  if (!isFormula(formula)) return formula;
  const body = formula.slice(1);
  let output = "";
  let index = 0;
  while (index < body.length) {
    if (body[index] === '"') {
      output += body[index];
      index += 1;
      while (index < body.length) {
        output += body[index];
        if (body[index] === '"') {
          if (body[index + 1] === '"') {
            output += body[index + 1];
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    const match = matchReferenceAt(body, index);
    if (match) {
      output += mapReference(match, mapRow);
      index = match.end;
      continue;
    }
    output += body[index];
    index += 1;
  }
  return `=${output}`;
}

function mapReference(
  match: { single: RegExpExecArray; endpoint: RegExpExecArray | null },
  mapRow: (col: number, row: number) => CellCoordinate | null,
): string {
  const { single, endpoint } = match;
  const startCol = columnIndexFromLabel(single[2]);
  const startRow = Number(single[4]) - 1;
  const movedStart = single[3] === "$" ? null : mapRow(startCol, startRow);
  if (!endpoint) {
    if (!movedStart) return single[0];
    return formatReference(single[1], movedStart.col, single[3], movedStart.row);
  }
  const endCol = columnIndexFromLabel(endpoint[2]);
  const endRow = Number(endpoint[4]) - 1;
  const movedEnd = endpoint[3] === "$" ? null : mapRow(endCol, endRow);
  if (!movedStart && !movedEnd) return `${single[0]}:${endpoint[0]}`;
  const start = movedStart ?? { col: startCol, row: startRow };
  const end = movedEnd ?? { col: endCol, row: endRow };
  const first = formatReference(
    single[1],
    Math.min(start.col, end.col),
    single[3],
    Math.min(start.row, end.row),
  );
  const last = formatReference(
    endpoint[1],
    Math.max(start.col, end.col),
    endpoint[3],
    Math.max(start.row, end.row),
  );
  return `${first}:${last}`;
}

/**
 * Returns `formula` with every relative reference moved by the offset; string
 * literals are untouched and non-formula text is returned unchanged.
 */
export function shiftFormulaByOffset(
  formula: string,
  rowDelta: number,
  colDelta: number,
  bounds: GridSize,
): string {
  if (!isFormula(formula)) return formula;
  if (rowDelta === 0 && colDelta === 0) return formula;
  const body = formula.slice(1);
  let output = "";
  let index = 0;
  while (index < body.length) {
    if (body[index] === '"') {
      output += body[index];
      index += 1;
      while (index < body.length) {
        output += body[index];
        if (body[index] === '"') {
          if (body[index + 1] === '"') {
            output += body[index + 1];
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    const match = matchReferenceAt(body, index);
    if (match) {
      output += offsetReference(match, rowDelta, colDelta, bounds);
      index = match.end;
      continue;
    }
    output += body[index];
    index += 1;
  }
  return `=${output}`;
}

import { columnLabel, columnIndexFromLabel } from "./workbook-model.mjs";

/**
 * Structural change applied to a worksheet grid along a single axis. `index`
 * is the zero-based insertion point (for `insert`) or the removed index (for
 * `delete`).
 *
 * @typedef {{ axis: "row" | "column", mode: "insert" | "delete", index: number }} StructureChange
 */

const REFERENCE_PATTERN = /^(\$?)([A-Za-z]{1,3})(\$?)([0-9]+)/;

/** True when the raw cell text is a formula expression (leading `=`). */
export function isFormula(raw) {
  return typeof raw === "string" && raw.startsWith("=");
}

function mapIndex(value, change) {
  if (change.mode === "insert") return value >= change.index ? value + 1 : value;
  if (value === change.index) return null;
  return value > change.index ? value - 1 : value;
}

/** Maps the low endpoint of a range, which survives deletion of its own index. */
function mapRangeStart(value, change) {
  if (change.mode === "insert") return value >= change.index ? value + 1 : value;
  return value <= change.index ? value : value - 1;
}

/** Maps the high endpoint of a range, which shrinks when its own index is removed. */
function mapRangeEnd(value, change) {
  if (change.mode === "insert") return value >= change.index ? value + 1 : value;
  return value < change.index ? value : value - 1;
}

/** Matches a cell reference (optionally an A1:B2 range) starting at `start`. */
function matchReferenceAt(text, start) {
  if (start > 0 && /[A-Za-z0-9_.]/.test(text[start - 1])) return null;
  const leftover = text.slice(start);
  const single = REFERENCE_PATTERN.exec(leftover);
  if (!single) return null;
  let end = start + single[0].length;
  let endpoint = null;
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

function formatReference(colMarker, col, rowMarker, row) {
  return `${colMarker}${columnLabel(col)}${rowMarker}${row + 1}`;
}

function transformReference(match, change) {
  const { single, endpoint } = match;
  const startCol = columnIndexFromLabel(single[2]);
  const startRow = Number(single[4]) - 1;

  if (!endpoint) {
    const col = change.axis === "column" ? mapIndex(startCol, change) : startCol;
    const row = change.axis === "row" ? mapIndex(startRow, change) : startRow;
    if (col === null || row === null) return "#REF!";
    return formatReference(single[1], col, single[3], row);
  }

  const endCol = columnIndexFromLabel(endpoint[2]);
  const endRow = Number(endpoint[4]) - 1;
  if (startCol > endCol || startRow > endRow) return match.single[0] + ":" + endpoint[0];

  const nextStartCol = change.axis === "column" ? mapRangeStart(startCol, change) : startCol;
  const nextEndCol = change.axis === "column" ? mapRangeEnd(endCol, change) : endCol;
  const nextStartRow = change.axis === "row" ? mapRangeStart(startRow, change) : startRow;
  const nextEndRow = change.axis === "row" ? mapRangeEnd(endRow, change) : endRow;
  if (nextStartCol > nextEndCol || nextStartRow > nextEndRow) return "#REF!";

  const start = formatReference(single[1], nextStartCol, single[3], nextStartRow);
  const finish = formatReference(endpoint[1], nextEndCol, endpoint[3], nextEndRow);
  return `${start}:${finish}`;
}

/**
 * Rewrites every A1 reference of `formula` through `translate`, leaving string
 * literals untouched. Non-formula text is returned unchanged.
 */
function transformFormula(formula, translate) {
  if (!isFormula(formula)) return formula;
  const body = formula.slice(1);
  let output = "";
  let index = 0;

  while (index < body.length) {
    const character = body[index];
    if (character === '"') {
      output += character;
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
      output += translate(match);
      index = match.end;
      continue;
    }
    output += character;
    index += 1;
  }

  return `=${output}`;
}

/**
 * Returns `formula` with every A1 reference remapped for a row/column
 * insertion or deletion. String literals are left untouched; references to a
 * deleted cell become `#REF!`. Non-formula text is returned unchanged.
 */
export function shiftFormula(formula, change) {
  return transformFormula(formula, (match) => transformReference(match, change));
}

/**
 * Returns `formula` with every relative A1 reference moved by the offset
 * between a copied range and its target; a `$`-marked column or row stays put.
 * A relative reference the offset would push outside `bounds` becomes `#REF!`,
 * and a reference to a deleted cell keeps that marker. Non-formula text and a
 * zero offset are returned unchanged.
 */
export function shiftFormulaByOffset(formula, rowDelta, colDelta, bounds) {
  if (!isFormula(formula)) return formula;
  if (rowDelta === 0 && colDelta === 0) return formula;
  return transformFormula(formula, (match) => offsetReference(match, rowDelta, colDelta, bounds));
}

/**
 * Returns `formula` with the rows of its A1 references remapped by `mapRow`.
 *
 * `mapRow(col, row)` receives a reference's zero-based column and row and
 * returns the `{col, row}` it moves to, or null to keep that reference as it
 * is. `$`-marked rows keep their row (like `shiftFormulaByOffset`), and range
 * endpoints are remapped together and normalized so the result stays a valid
 * range. Non-formula text is returned unchanged.
 *
 * The sort command uses this so the formulas of a moved record keep pointing
 * at the records they referenced before the rows were reordered.
 */
export function mapFormulaRows(formula, mapRow) {
  return transformFormula(formula, (match) => {
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
    const minCol = Math.min(start.col, end.col);
    const maxCol = Math.max(start.col, end.col);
    const minRow = Math.min(start.row, end.row);
    const maxRow = Math.max(start.row, end.row);
    const first = formatReference(single[1], minCol, single[3], minRow);
    const last = formatReference(endpoint[1], maxCol, endpoint[3], maxRow);
    return `${first}:${last}`;
  });
}

function insideBounds(row, col, bounds) {
  return row >= 0 && col >= 0 && row < bounds.rowCount && col < bounds.columnCount;
}

/** Moves one endpoint of a reference, honouring the `$` absolute markers. */
function offsetEndpoint(match, index, rowDelta, colDelta, bounds) {
  const colMarker = match[index + 1] ?? "";
  const rowMarker = match[index + 3] ?? "";
  const col = columnIndexFromLabel(match[index + 2]);
  const row = Number(match[index + 4]) - 1;
  const nextCol = colMarker === "$" ? col : col + colDelta;
  const nextRow = rowMarker === "$" ? row : row + rowDelta;
  if (!insideBounds(nextRow, nextCol, bounds)) return null;
  return { colMarker, rowMarker, col: nextCol, row: nextRow };
}

function offsetReference(match, rowDelta, colDelta, bounds) {
  const { single, endpoint } = match;
  const start = offsetEndpoint(single, 0, rowDelta, colDelta, bounds);
  if (!start) return "#REF!";
  const startText = formatReference(start.colMarker, start.col, start.rowMarker, start.row);
  if (!endpoint) return startText;
  const end = offsetEndpoint(endpoint, 0, rowDelta, colDelta, bounds);
  if (!end) return "#REF!";
  if (start.row > end.row || start.col > end.col) return "#REF!";
  return `${startText}:${formatReference(end.colMarker, end.col, end.rowMarker, end.row)}`;
}

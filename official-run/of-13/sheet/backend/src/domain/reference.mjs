/**
 * A1 reference translation for formulas.
 *
 * `translateFormulaText` handles **copying**: a copied formula keeps its shape but its
 * *relative* parts move with the target offset, while `$`-marked (absolute) parts stay put:
 * copying `=$A1+B$2+$C$3` one row down and one column right yields `=$A2+C$2+$C$3`. A relative
 * part that would leave the grid becomes `#REF!`, the stable error text the grid and the
 * formula bar display.
 *
 * `adjustFormulaTextForStructure` handles **row/column structure changes**: inserting or
 * deleting a row/column moves the addresses that formulas point at, so every reference at or
 * beyond the insertion point shifts with it (absolute `$` references too, exactly like a
 * spreadsheet). A reference to a deleted row/column becomes `#REF!`, which evaluates to the
 * same stable error value.
 *
 * The raw formula text stays the single source of truth (the formula bar shows it and the
 * store persists it); these helpers only rewrite references inside it and never touch the
 * rest of the expression, so text literals such as `"A1"` and function names such as `SUM`
 * survive unchanged.
 */

const REFERENCE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)/;
const LETTER = /[A-Za-z_]/;
const IDENTIFIER_CHAR = /[A-Za-z0-9_]/;

export const DEFAULT_TRANSLATE_ROWS = 50;
export const DEFAULT_TRANSLATE_COLUMNS = 26;

function columnIndex(letters) {
  let value = 0;
  for (const letter of letters) value = value * 26 + (letter.charCodeAt(0) - 64);
  return value;
}

function columnLetters(index) {
  let label = "";
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) {
    label = String.fromCharCode(65 + ((value - 1) % 26)) + label;
  }
  return label;
}

function translateReference(columnMark, letters, rowMark, rowNumber, rowDelta, columnDelta, size) {
  const column = columnIndex(letters.toUpperCase());
  const absoluteColumn = columnMark === "$";
  const absoluteRow = rowMark === "$";
  const nextColumn = absoluteColumn ? column : column + columnDelta;
  const nextRow = absoluteRow ? rowNumber : rowNumber + rowDelta;
  if (nextRow < 1 || nextRow > size.rows || nextColumn < 1 || nextColumn > size.columns) {
    return "#REF!";
  }
  return `${columnMark}${columnLetters(nextColumn)}${rowMark}${nextRow}`;
}

/**
 * Rewrites the references of one raw cell text.
 *
 * @param {string} text raw cell text (`=A1+B2` for a formula)
 * @param {number} rowDelta rows the value moves down (negative moves it up)
 * @param {number} columnDelta columns the value moves right (negative moves it left)
 * @param {{ rows?: number, columns?: number }} [size] grid bounds used to detect `#REF!`
 * @returns {string} the translated text; non-formula text is returned unchanged
 */
/**
 * Rewrites every A1 reference of a formula *body* (the text after the leading `=`).
 *
 * @param {string} body formula text without the leading `=`
 * @param {(match: { columnMark: string, letters: string, rowMark: string, row: number,
 *   column: number }) => string} rewrite replacement text of one reference
 */
function rewriteBody(body, rewrite) {
  let out = "";
  let index = 0;
  while (index < body.length) {
    const char = body[index];
    if (char === '"') {
      // A text literal is copied verbatim: `"A1"` is text, not a reference.
      let end = index + 1;
      while (end < body.length && body[end] !== '"') end += 1;
      const stop = Math.min(end + 1, body.length);
      out += body.slice(index, stop);
      index = stop;
      continue;
    }
    const match = REFERENCE.exec(body.slice(index));
    const previous = index > 0 ? body[index - 1] : "";
    if (match && !IDENTIFIER_CHAR.test(previous)) {
      const [whole, columnMark, letters, rowMark, digits] = match;
      const next = body[index + whole.length] ?? "";
      // `SUM(` is a function name, not a reference; a trailing letter means a longer
      // identifier (`ABCD1`) that is not an A1 reference either.
      if (!LETTER.test(next) && next !== "(") {
        out += rewrite({
          columnMark,
          letters,
          rowMark,
          row: Number(digits),
          column: columnIndex(letters.toUpperCase()),
        });
        index += whole.length;
        continue;
      }
    }
    out += char;
    index += 1;
  }
  return out;
}

/** Rewrites the references of one raw cell text; non-formula text is returned unchanged. */
function rewriteFormulaText(text, rewrite) {
  const source = String(text ?? "");
  if (!source.startsWith("=")) return source;
  return `=${rewriteBody(source.slice(1), rewrite)}`;
}

export function translateFormulaText(text, rowDelta, columnDelta, size = {}) {
  const bounds = {
    rows: Number.isInteger(size.rows) && size.rows > 0 ? size.rows : DEFAULT_TRANSLATE_ROWS,
    columns:
      Number.isInteger(size.columns) && size.columns > 0
        ? size.columns
        : DEFAULT_TRANSLATE_COLUMNS,
  };

  return rewriteFormulaText(text, ({ columnMark, letters, rowMark, row }) =>
    translateReference(columnMark, letters, rowMark, row, rowDelta, columnDelta, bounds),
  );
}

/**
 * Coordinate mapping of one row/column structure operation.
 *
 * @param {{ axis?: string, action?: string, index?: number }} change 1-based target of the
 *   row-number / column-header menu command
 * @returns {{ axis: "row" | "column", map: (coordinate: number) => number | null } | null}
 *   `null` when the change is not a known structure operation; `map` returns `null` for a
 *   coordinate that the deletion removed.
 */
export function structureShiftMapper(change) {
  const axis = change?.axis;
  const action = change?.action;
  const index = Number(change?.index);
  if ((axis !== "row" && axis !== "column") || !Number.isInteger(index) || index < 1) return null;
  if (action === "delete") {
    return {
      axis,
      map: (coordinate) =>
        coordinate === index ? null : coordinate > index ? coordinate - 1 : coordinate,
    };
  }
  const insertAbove = axis === "row" ? "insert-above" : "insert-left";
  const insertBelow = axis === "row" ? "insert-below" : "insert-right";
  if (action !== insertAbove && action !== insertBelow) return null;
  // `insert-below 3` inserts at row 4, the same position `insert-above 4` uses.
  const insertion = action === insertAbove ? index : index + 1;
  return {
    axis,
    map: (coordinate) => (coordinate >= insertion ? coordinate + 1 : coordinate),
  };
}

/**
 * Rewrites the references of one raw cell text after a row/column structure change.
 * A reference to a deleted row/column becomes `#REF!`; `$` marks are preserved.
 *
 * @param {string} text raw cell text (`=A1+B1` for a formula)
 * @param {{ axis?: "row" | "column", action?: string, index?: number }} change
 * @returns {string} the adjusted text; non-formula text is returned unchanged
 */
export function adjustFormulaTextForStructure(text, change) {
  const mapper = structureShiftMapper(change);
  if (!mapper) return String(text ?? "");
  return rewriteFormulaText(text, ({ columnMark, letters, rowMark, row, column }) => {
    if (mapper.axis === "row") {
      const nextRow = mapper.map(row);
      return nextRow === null ? "#REF!" : `${columnMark}${letters}${rowMark}${nextRow}`;
    }
    const nextColumn = mapper.map(column);
    return nextColumn === null
      ? "#REF!"
      : `${columnMark}${columnLetters(nextColumn)}${rowMark}${row}`;
  });
}

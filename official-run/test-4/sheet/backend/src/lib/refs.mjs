/**
 * Formula reference rewriting for worksheet structure operations.
 *
 * Cell text that starts with "=" is treated as a formula: plain A1-style
 * references and ranges (A1:B3) are adjusted when a row or column is inserted
 * or deleted, so a formula keeps pointing at the same logical cells after the
 * structure change. A reference that pointed directly into a deleted row or
 * column cannot be preserved and becomes #REF! (spreadsheet semantics).
 *
 * Only the formula *text* is adjusted here; evaluation of formula results is
 * provided by the formula engine feature (REQ-3-1). Cells that are not
 * formulas pass through unchanged.
 */

const REF_TOKEN = String.raw`\$?[A-Za-z]{1,3}\$?[1-9]\d*`;
const RANGE_PATTERN = new RegExp(`(${REF_TOKEN})(?::(${REF_TOKEN}))?`, "g");

function indexToLetters(index) {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function lettersToIndex(letters) {
  let col = 0;
  for (const ch of letters.toUpperCase()) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return col - 1;
}

/**
 * @param {string} token an A1-style reference token, e.g. "B2" or "$A$1".
 * @returns {{colLocked: boolean, rowLocked: boolean, letters: string, row: number} | null}
 */
function parseRefToken(token) {
  const match = /^(\$?)([A-Za-z]+)(\$?)([1-9]\d*)$/.exec(token);
  if (!match) return null;
  return {
    colLocked: match[1] === "$",
    rowLocked: match[3] === "$",
    letters: match[2],
    row: Number(match[4]),
  };
}

/**
 * Adjust a single reference coordinate.
 *
 * @param {number} col 0-based column index of the reference.
 * @param {number} row 1-based row number of the reference.
 * @param {{axis: "row"|"column", insert?: number, delete?: number}} op
 * @returns {{col: number, row: number} | null} adjusted coordinates, or null
 *   when the reference points into a deleted row/column and cannot be kept.
 */
export function adjustReference(col, row, op) {
  if (op.axis === "column") {
    if (op.delete !== undefined) {
      if (col === op.delete) return null;
      if (col > op.delete) col -= 1;
    } else if (col >= op.insert) {
      col += 1;
    }
  } else {
    if (op.delete !== undefined) {
      if (row === op.delete) return null;
      if (row > op.delete) row -= 1;
    } else if (row >= op.insert) {
      row += 1;
    }
  }
  return { col, row };
}

/**
 * Rewrite the references of one formula-text cell value.
 *
 * @param {string} text raw cell value.
 * @param {{axis: "row"|"column", insert?: number, delete?: number}} op
 *   structure operation. `insert` is the 0-based target index at which a new
 *   row/column was added; `delete` is the 0-based index (row number minus 1)
 *   of the removed row/column.
 * @returns {string} adjusted cell value.
 */
export function rewriteFormulaRefs(text, op) {
  if (typeof text !== "string" || !text.startsWith("=")) return text;

  function shiftToken(token) {
    const parsed = parseRefToken(token);
    if (!parsed) return token;
    const adjusted = adjustReference(lettersToIndex(parsed.letters), parsed.row, op);
    if (!adjusted) return null;
    const letters = indexToLetters(adjusted.col);
    return `${parsed.colLocked ? "$" : ""}${letters}${parsed.rowLocked ? "$" : ""}${adjusted.row}`;
  }

  return text.replace(RANGE_PATTERN, (whole, ref1, ref2) => {
    const shifted1 = shiftToken(ref1);
    if (!shifted1) return "#REF!";
    if (ref2 === undefined) return shifted1;
    const shifted2 = shiftToken(ref2);
    if (!shifted2) return "#REF!";
    return `${shifted1}:${shifted2}`;
  });
}

/**
 * Translate the references of one formula-text cell value for a range copy
 * or cut (REQ-3-2-1). Relative references shift by the paste offset while
 * absolute ($A$1-style) references stay unchanged; ranges adjust both
 * endpoints. A reference that would land on an invalid coordinate (before
 * row 1 or column A) becomes #REF!.
 *
 * Only the formula *text* is adjusted; evaluation happens downstream in the
 * formula engine. Non-formula cell values pass through unchanged.
 *
 * @param {string} text raw cell value.
 * @param {{rowOffset?: number, colOffset?: number}} offsets target minus
 *   source top-left corner (rows 1-based, columns 0-based).
 * @returns {string} adjusted cell value.
 */
export function translateFormulaRefs(text, { rowOffset = 0, colOffset = 0 } = {}) {
  if (typeof text !== "string" || !text.startsWith("=")) return text;

  function shiftToken(token) {
    const parsed = parseRefToken(token);
    if (!parsed) return token;
    const col = parsed.colLocked
      ? lettersToIndex(parsed.letters)
      : lettersToIndex(parsed.letters) + colOffset;
    const row = parsed.rowLocked ? parsed.row : parsed.row + rowOffset;
    if (col < 0 || row < 1) return null;
    const letters = indexToLetters(col);
    return `${parsed.colLocked ? "$" : ""}${letters}${parsed.rowLocked ? "$" : ""}${row}`;
  }

  return text.replace(RANGE_PATTERN, (whole, ref1, ref2) => {
    const shifted1 = shiftToken(ref1);
    if (!shifted1) return "#REF!";
    if (ref2 === undefined) return shifted1;
    const shifted2 = shiftToken(ref2);
    if (!shifted2) return "#REF!";
    return `${shifted1}:${shifted2}`;
  });
}

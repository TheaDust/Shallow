/**
 * Sorting of one rectangular data range (REQ-5-1-1).
 *
 * Sorting rewrites the row order *inside* the selected rectangle only: every
 * record (all columns of the range) moves as one row, coordinates outside the
 * range keep their value, and the used rectangle, the stored validation rules
 * and the filter view are not touched (they keep applying to the same range).
 * Formulas travel with their record as the original stored text, exactly like a
 * plain value, so the grid recomputes their result at the new position.
 *
 * The key column is compared by its own type: a column whose non-blank values
 * are all numbers sorts numerically, a column whose values are all parseable
 * dates sorts chronologically, anything else sorts as text. Equal keys keep
 * their original relative order (the sort is stable), and blank keys sort last
 * in both directions.
 */
import { DomainError } from "./errors.mjs";
import { toCellName } from "./grid.mjs";
import { parseRange } from "./validation.mjs";

export const SORT_ORDERS = Object.freeze(["ascending", "descending"]);

/** Plain decimal text (optionally signed/exponent): the number type probe. */
const NUMBER_TEXT = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Numeric reading of one cell text, or null when it is not a plain number. */
export function numberValue(text) {
  const trimmed = String(text ?? "").trim();
  if (!NUMBER_TEXT.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Timestamp of one cell text, or null when it cannot be parsed as a date. */
export function dateValue(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  const value = Date.parse(trimmed);
  return Number.isFinite(value) ? value : null;
}

function isBlank(text) {
  return String(text ?? "").trim() === "";
}

/**
 * Comparison type of one key column: `"number"` when every non-blank value
 * reads as a number, `"date"` when every non-blank value parses as a date, and
 * `"text"` otherwise (an empty column is text).
 */
export function detectColumnType(values) {
  const present = values.filter((value) => !isBlank(value));
  if (!present.length) return "text";
  if (present.every((value) => numberValue(value) !== null)) return "number";
  if (present.every((value) => dateValue(value) !== null)) return "date";
  return "text";
}

/**
 * Order of two non-blank keys of one type (`-1`, `0`, `1`); blank keys are
 * handled by the comparator so they always end up last.
 */
export function compareValues(left, right, type) {
  if (type === "number") {
    const difference = numberValue(left) - numberValue(right);
    return difference < 0 ? -1 : difference > 0 ? 1 : 0;
  }
  if (type === "date") {
    const difference = dateValue(left) - dateValue(right);
    return difference < 0 ? -1 : difference > 0 ? 1 : 0;
  }
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Comparator of one sort request. Descending reverses the comparison of real
 * keys; blanks stay last in both directions (the usual spreadsheet reading of
 * an empty cell), and equal keys return 0 so the caller's index tiebreaker
 * keeps their original relative order.
 */
export function makeComparator(type, order) {
  const factor = order === "descending" ? -1 : 1;
  return (left, right) => {
    if (isBlank(left) || isBlank(right)) {
      if (isBlank(left) && isBlank(right)) return 0;
      return isBlank(left) ? 1 : -1;
    }
    return compareValues(left, right, type) * factor;
  };
}

/** First-row text of one range column, used to resolve a `column` header text. */
function headerText(worksheet, range, col) {
  const value = worksheet.cells?.[toCellName(range.minRow, col)];
  return typeof value === "string" ? value.trim() : "";
}

/** Column index of a header text inside the range (`null` when not found). */
function columnByHeader(worksheet, range, label) {
  const key = label.trim().toLowerCase();
  if (!key) return null;
  for (let col = range.minCol; col <= range.maxCol; col += 1) {
    if (headerText(worksheet, range, col).toLowerCase() === key) return col;
  }
  return null;
}

/** Column index of a plain A1 column label (`"B"` → 1), when inside the range. */
function columnByLabel(range, label) {
  const match = /^[A-Za-z]{1,3}$/.exec(label.trim());
  if (!match) return null;
  let col = 0;
  for (const character of match[0].toUpperCase()) col = col * 26 + (character.charCodeAt(0) - 64);
  col -= 1;
  return col >= range.minCol && col <= range.maxCol ? col : null;
}

/**
 * Validates and normalizes one sort request against the worksheet it targets.
 * `column` may be an absolute column index, a column label or the header text
 * of the range; the range, order and header flag are checked before any write,
 * so a rejected sort leaves the grid in its original order.
 */
export function normalizeSortRequest(input, worksheet) {
  const raw = input && typeof input === "object" ? input : {};
  const rangeText = typeof raw.range === "string" ? raw.range.trim().toUpperCase() : "";
  const range = parseRange(rangeText);
  if (!range) throw new DomainError(`Invalid sort range: ${raw.range}`, 400);

  const order = typeof raw.order === "string" ? raw.order.trim().toLowerCase() : "";
  if (!SORT_ORDERS.includes(order)) throw new DomainError(`Unknown sort order: ${raw.order}`, 400);

  const hasHeaderRow = raw.hasHeaderRow === true;
  const firstDataRow = range.minRow + (hasHeaderRow ? 1 : 0);
  if (firstDataRow > range.maxRow) {
    throw new DomainError("Select a range with data rows to sort", 400);
  }

  let column = null;
  const rawColumn = raw.column;
  if (Number.isInteger(rawColumn)) column = rawColumn;
  else if (typeof rawColumn === "string" && /^\d+$/.test(rawColumn.trim())) column = Number(rawColumn.trim());
  if (column === null && typeof rawColumn === "string") {
    column = columnByHeader(worksheet, range, rawColumn) ?? columnByLabel(range, rawColumn);
  }
  if (column === null) throw new DomainError(`Unknown sort column: ${raw.column}`, 400);
  if (column < range.minCol || column > range.maxCol) {
    throw new DomainError("Sort column is outside the selected range", 400);
  }

  return { range, column, order, hasHeaderRow };
}

/**
 * New cell map of one worksheet after sorting `request.range`: the rows of the
 * rectangle are permuted (the header row stays in place when declared), a row's
 * whole width moves together, and every coordinate outside the rectangle keeps
 * its value.
 */
export function sortWorksheetCells(worksheet, request) {
  const { range, column, order, hasHeaderRow } = request;
  const cells = worksheet.cells ?? {};
  const width = range.maxCol - range.minCol + 1;
  const rows = [];
  for (let row = range.minRow; row <= range.maxRow; row += 1) {
    const values = [];
    for (let col = range.minCol; col <= range.maxCol; col += 1) {
      const value = cells[toCellName(row, col)];
      values.push(typeof value === "string" ? value : "");
    }
    rows.push(values);
  }
  const header = hasHeaderRow ? rows.slice(0, 1) : [];
  const data = hasHeaderRow ? rows.slice(1) : rows;
  const keyOffset = column - range.minCol;
  const type = detectColumnType(data.map((values) => values[keyOffset]));
  const comparator = makeComparator(type, order);
  // The index tiebreaker keeps equal sort keys in their original relative order
  // independently of the runtime's sort stability.
  const sorted = data
    .map((values, index) => ({ values, index }))
    .sort((left, right) => comparator(left.values[keyOffset], right.values[keyOffset]) || left.index - right.index)
    .map((entry) => entry.values);

  const next = { ...cells };
  [...header, ...sorted].forEach((values, offset) => {
    const row = range.minRow + offset;
    for (let colOffset = 0; colOffset < width; colOffset += 1) {
      const name = toCellName(row, range.minCol + colOffset);
      const value = values[colOffset];
      if (value === "") delete next[name];
      else next[name] = value;
    }
  });
  return next;
}

import { cellName } from "./cells.mjs";
import { translateFormula } from "./transfer.mjs";

/**
 * Sorting of one selected rectangular range (REQ-5-1-1). A stable, type-aware comparison
 * permutes the whole records of the range by row; the header row and everything outside
 * the range stay put. Moved formulas keep referencing the same relative cells.
 */
export const SORT_ORDERS = Object.freeze(["ascending", "descending"]);

export const SORT_RANGE_INVALID_MESSAGE = "Invalid sort range";
export const SORT_COLUMN_INVALID_MESSAGE = "Invalid sort column";
export const SORT_ORDER_INVALID_MESSAGE = "Unable to sort the selected range";

const NUMERIC_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function rawText(worksheet, row, column) {
  return String(worksheet?.cells?.[cellName(row, column)]?.value ?? "");
}

/**
 * Type-aware key of one sort value: numbers compare numerically, parseable dates compare
 * by time and everything else compares as text. Blank text sorts with the text bucket.
 */
export function sortKey(value) {
  const text = String(value ?? "").trim();
  if (text !== "" && NUMERIC_TEXT.test(text)) return { rank: 0, value: Number(text) };
  if (text !== "") {
    const time = Date.parse(text);
    if (!Number.isNaN(time)) return { rank: 1, value: time };
  }
  return { rank: 2, value: text.toLowerCase() };
}

/** Compares two keys of the same or different buckets without collapsing their types. */
export function compareSortKeys(left, right) {
  if (left.rank !== right.rank) return left.rank - right.rank;
  if (left.value < right.value) return -1;
  if (left.value > right.value) return 1;
  return 0;
}

/**
 * Cells of one worksheet after sorting the data rows of `bounds` by one column of the
 * range. Equal keys keep their original relative order (the index breaks every tie), so
 * the operation is a stable permutation of whole records. Relative references of a moved
 * formula follow its row; `$`-absolute parts and the untouched rows keep their coordinates.
 */
export function sortRangeCells(worksheet, { bounds, column, order, hasHeader }) {
  const firstDataRow = hasHeader ? bounds.top + 1 : bounds.top;
  const dataRows = [];
  for (let row = firstDataRow; row <= bounds.bottom; row += 1) dataRows.push(row);
  if (dataRows.length === 0) return structuredClone(worksheet?.cells ?? {});

  const original = worksheet?.cells ?? {};
  const width = bounds.right - bounds.left + 1;
  const records = dataRows.map((row) => {
    const record = [];
    for (let offset = 0; offset < width; offset += 1) {
      record.push(original[cellName(row, bounds.left + offset)]);
    }
    return record;
  });
  const keys = dataRows.map((row) => sortKey(rawText(worksheet, row, column)));
  const direction = order === "descending" ? -1 : 1;
  const positions = records.map((_, index) => index);
  positions.sort((left, right) => {
    const comparison = compareSortKeys(keys[left], keys[right]);
    return comparison !== 0 ? comparison * direction : left - right;
  });

  const cells = structuredClone(original);
  dataRows.forEach((targetRow, position) => {
    const sourceIndex = positions[position];
    const sourceRow = dataRows[sourceIndex];
    const rowDelta = targetRow - sourceRow;
    for (let offset = 0; offset < width; offset += 1) {
      const target = cellName(targetRow, bounds.left + offset);
      const cell = records[sourceIndex][offset];
      if (!cell) {
        delete cells[target];
        continue;
      }
      const next = { ...cell };
      if (typeof cell.formula === "string" && cell.formula !== "") {
        next.formula = translateFormula(cell.formula, rowDelta, 0);
      }
      cells[target] = next;
    }
  });
  return cells;
}

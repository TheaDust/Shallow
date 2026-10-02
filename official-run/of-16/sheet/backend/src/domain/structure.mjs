import { columnName, parseCellName, toCellName } from "./grid.mjs";

/**
 * Row and column structure operations for one worksheet (REQ-2-2).
 *
 * A worksheet stores its values in a sparse `cells` map plus a used rectangle
 * (`usedRows`/`usedCols`) and an explicit grid size (`rowCount`/`columnCount`).
 * Inserting shifts the target coordinate and every later coordinate by one,
 * deleting removes the target coordinate and pulls the later ones up/left.
 * Formula text (`=`-prefixed values) keeps its original shape with adjusted
 * references; a reference that cannot survive its row/column deletion becomes
 * `#REF!`, which is how the explicit error reaches the grid.
 */

export const ROW_ACTIONS = Object.freeze(["insert-above", "insert-below", "delete"]);
export const COLUMN_ACTIONS = Object.freeze(["insert-left", "insert-right", "delete"]);

/**
 * Coordinate a change acts on: the insertion point for an insert (the blank row
 * goes above/below or left/right of the target), or the removed coordinate for
 * a delete.
 */
export function changePosition(action, index) {
  if (action === "delete") return index;
  return action === "insert-above" || action === "insert-left" ? index : index + 1;
}

/**
 * A1-style reference, optionally a `A1:B2` pair. Absolute markers are captured
 * separately so they survive the rewrite. The lookaround keeps function names
 * such as `LOG10` and cell text containing letters next to the match out.
 */
const REFERENCE = /(?<![A-Za-z0-9_])(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]*)(?::(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]*))?(?![A-Za-z0-9_(])/g;

function token(absCol, letters, absRow, digits) {
  let col = 0;
  for (const character of letters.toUpperCase()) col = col * 26 + (character.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(digits) - 1, absCol, absRow };
}

function render(point) {
  return `${point.absCol ? "$" : ""}${columnName(point.col)}${point.absRow ? "$" : ""}${point.row + 1}`;
}

function move(point, axis, delta) {
  return axis === "row" ? { ...point, row: point.row + delta } : { ...point, col: point.col + delta };
}

function coordinate(point, axis) {
  return axis === "row" ? point.row : point.col;
}

/** Single reference: insert shifts by one, delete removes or pulls up/left. */
function adjustSingle(point, axis, index, mode) {
  const value = coordinate(point, axis);
  if (mode === "insert") return value >= index ? move(point, axis, 1) : point;
  if (value > index) return move(point, axis, -1);
  return value === index ? null : point;
}

/**
 * Range reference: an insert inside the range grows it (both endpoints above
 * the insertion point move down), a delete inside the range shrinks it by one
 * entry (`A2:A4` deleting row 2 becomes `A2:A3`), and deleting the whole range
 * leaves `#REF!`.
 */
function adjustRange(first, second, axis, index, mode) {
  const firstValue = coordinate(first, axis);
  const secondValue = coordinate(second, axis);
  const low = Math.min(firstValue, secondValue);
  const high = Math.max(firstValue, secondValue);
  if (mode === "insert") {
    if (high < index) return [first, second];
    if (low >= index) return [move(first, axis, 1), move(second, axis, 1)];
    const movedFirst = firstValue >= index ? move(first, axis, 1) : first;
    const movedSecond = secondValue >= index ? move(second, axis, 1) : second;
    return [movedFirst, movedSecond];
  }
  if (high < index) return [first, second];
  if (low > index) return [move(first, axis, -1), move(second, axis, -1)];
  if (high - 1 < low) return null;
  // The low endpoint stays put; the high endpoint is pulled one step up/left.
  const shrink = (point) => (coordinate(point, axis) === high ? move(point, axis, -1) : point);
  return [shrink(first), shrink(second)];
}

/**
 * Rewrites the cell references of one formula for a row (`axis = "row"`) or
 * column (`axis = "column"`) structure change. `index` is the 0-based insertion
 * position for `mode = "insert"` and the deleted coordinate for
 * `mode = "delete"`.
 */
export function adjustCellReferences(text, axis, index, mode) {
  return String(text).replace(REFERENCE, (match, absCol1, letters1, absRow1, digits1, absCol2, letters2, absRow2, digits2) => {
    const first = token(absCol1, letters1, absRow1, digits1);
    if (digits2 === undefined) {
      const single = adjustSingle(first, axis, index, mode);
      return single ? render(single) : "#REF!";
    }
    const second = token(absCol2, letters2, absRow2, digits2);
    const range = adjustRange(first, second, axis, index, mode);
    return range ? `${render(range[0])}:${render(range[1])}` : "#REF!";
  });
}

/** Adjusts one cell value; ordinary values (and everything else) stay as they are. */
export function shiftCellValue(value, axis, index, mode) {
  return typeof value === "string" && value.startsWith("=")
    ? adjustCellReferences(value, axis, index, mode)
    : value;
}

function movedCells(cells, moveRef) {
  const next = {};
  for (const [name, value] of Object.entries(cells ?? {})) {
    const ref = parseCellName(name);
    if (!ref) continue;
    const moved = moveRef(ref);
    if (!moved) continue;
    next[toCellName(moved.row, moved.col)] = value;
  }
  return next;
}

function usedAfterChange(used, index, growing) {
  if (growing) return index < used ? used + 1 : used;
  return index < used ? Math.max(used - 1, 0) : used;
}

/**
 * Row patch for one worksheet: `{ cells, usedRows, rowCount }`. `index` is the
 * target row of the visible row-number menu (`insert-above` puts the blank row
 * at `index`, `insert-below` at `index + 1`).
 */
export function shiftWorksheetRows(worksheet, action, index) {
  const cells = worksheet.cells ?? {};
  const usedRows = worksheet.usedRows ?? 0;
  if (action === "delete") {
    return {
      cells: movedCells(cells, (ref) => {
        if (ref.row === index) return null;
        return ref.row > index ? { ...ref, row: ref.row - 1 } : ref;
      }),
      usedRows: usedAfterChange(usedRows, index, false),
      rowCount: Math.max(worksheet.rowCount, usedAfterChange(usedRows, index, false) + 1),
    };
  }
  const at = changePosition(action, index);
  const nextUsed = usedAfterChange(usedRows, at, true);
  return {
    cells: movedCells(cells, (ref) => (ref.row >= at ? { ...ref, row: ref.row + 1 } : ref)),
    usedRows: nextUsed,
    rowCount: Math.max(worksheet.rowCount, at + 1, nextUsed + 1),
  };
}

/** Column patch for one worksheet: `{ cells, usedCols, columnCount }`. */
export function shiftWorksheetColumns(worksheet, action, index) {
  const cells = worksheet.cells ?? {};
  const usedCols = worksheet.usedCols ?? 0;
  if (action === "delete") {
    return {
      cells: movedCells(cells, (ref) => {
        if (ref.col === index) return null;
        return ref.col > index ? { ...ref, col: ref.col - 1 } : ref;
      }),
      usedCols: usedAfterChange(usedCols, index, false),
      columnCount: Math.max(worksheet.columnCount, usedAfterChange(usedCols, index, false) + 1),
    };
  }
  const at = changePosition(action, index);
  const nextUsed = usedAfterChange(usedCols, at, true);
  return {
    cells: movedCells(cells, (ref) => (ref.col >= at ? { ...ref, col: ref.col + 1 } : ref)),
    usedCols: nextUsed,
    columnCount: Math.max(worksheet.columnCount, at + 1, nextUsed + 1),
  };
}

/**
 * Shifts the A1 range of one stored validation rule with its constrained cells
 * (REQ-5-2): an insert moves or grows the range, a delete pulls it up/left and
 * dropping the whole range removes the rule instead of leaving it dangling.
 */
export function shiftValidationRange(rule, axis, index, mode) {
  const range = adjustCellReferences(String(rule?.range ?? ""), axis, index, mode);
  if (range === "#REF!") return null;
  return { ...rule, range };
}

/**
 * Shifts every validation rule of a worksheet; rules whose cells were removed
 * are dropped because nothing is constrained any more.
 */
export function shiftValidations(validations, axis, index, mode) {
  if (!Array.isArray(validations)) return validations;
  return validations
    .map((rule) => shiftValidationRange(rule, axis, index, mode))
    .filter(Boolean);
}

/**
 * Shifts the region of a worksheet filter (REQ-5-1-2). The rules stay attached
 * to their header text, so a column that moves inside the region keeps its
 * constraint; a region that no longer exists drops the filter.
 */
export function shiftFilter(filter, axis, index, mode) {
  if (!filter || typeof filter !== "object") return filter;
  const range = adjustCellReferences(String(filter.range ?? ""), axis, index, mode);
  if (range === "#REF!") return null;
  return { ...filter, range };
}

/**
 * Shifts the A1 source range of one pivot table (REQ-5-3-1) with its source
 * cells: the moved coordinates are the ones a later refresh reads. A range that
 * no longer exists keeps the pivot but loses its range, so the refresh reports
 * an unusable source instead of reading the wrong data.
 */
export function shiftPivotSourceRange(pivot, axis, action, index) {
  if (!pivot || typeof pivot !== "object") return pivot;
  const mode = action === "delete" ? "delete" : "insert";
  const range = adjustCellReferences(
    String(pivot.sourceRange ?? ""),
    axis,
    changePosition(action, index),
    mode,
  );
  return range === "#REF!" ? { ...pivot, sourceRange: "" } : { ...pivot, sourceRange: range };
}

/**
 * Applies the structure change to the cells, the grid size and the ranges of
 * the stored validation rules and filter of one worksheet. Values that are not
 * formulas are carried over verbatim; formulas of moved cells are rewritten for
 * the same change.
 */
export function shiftWorksheetStructure(worksheet, axis, action, index) {
  const patch = axis === "row"
    ? shiftWorksheetRows(worksheet, action, index)
    : shiftWorksheetColumns(worksheet, action, index);
  const mode = action === "delete" ? "delete" : "insert";
  const referenceIndex = changePosition(action, index);
  const cells = {};
  for (const [name, value] of Object.entries(patch.cells)) {
    cells[name] = shiftCellValue(value, axis, referenceIndex, mode);
  }
  return {
    ...patch,
    cells,
    validations: shiftValidations(worksheet.validations, axis, referenceIndex, mode),
    filter: shiftFilter(worksheet.filter, axis, referenceIndex, mode),
  };
}

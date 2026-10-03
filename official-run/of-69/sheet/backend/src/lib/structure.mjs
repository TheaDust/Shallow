import { cellName, columnLabel, parseCellName } from "./cells.mjs";
import { shiftFilter } from "./filter.mjs";

/** Actions offered by the row-number menu and the column-header menu. */
export const ROW_ACTIONS = Object.freeze(["insert-above", "insert-below", "delete"]);
export const COLUMN_ACTIONS = Object.freeze(["insert-left", "insert-right", "delete"]);

const KIND_BY_ACTION = new Map([
  ["insert-above", "before"],
  ["insert-left", "before"],
  ["insert-below", "after"],
  ["insert-right", "after"],
  ["delete", "delete"],
]);

export function structureActions(axis) {
  return axis === "row" ? ROW_ACTIONS : axis === "column" ? COLUMN_ACTIONS : null;
}

export function structureKind(action) {
  return KIND_BY_ACTION.get(action) ?? null;
}

function mapBound(value, kind, index) {
  if (kind === "delete") return value === index ? null : value > index ? value - 1 : value;
  const threshold = kind === "before" ? index : index + 1;
  return value >= threshold ? value + 1 : value;
}

/**
 * Rewrites one validation `range` after an insertion/deletion; `null` drops a rule whose
 * whole range was removed. The removed coordinate simply leaves the covered set.
 */
export function shiftValidationRange(range, { isRow, kind, index }) {
  const match = /^\s*(\$?[A-Za-z]{1,3}\$?[1-9][0-9]*):(\$?[A-Za-z]{1,3}\$?[1-9][0-9]*)\s*$/.exec(String(range ?? ""));
  if (!match) return null;
  const start = parseCellName(match[1].replace(/\$/g, ""));
  const end = parseCellName(match[2].replace(/\$/g, ""));
  if (!start || !end) return null;
  const top = Math.min(start.row, end.row);
  const bottom = Math.max(start.row, end.row);
  const left = Math.min(start.column, end.column);
  const right = Math.max(start.column, end.column);
  const mappedRows = (isRow ? [mapBound(top, kind, index), mapBound(bottom, kind, index)] : [top, bottom])
    .filter((value) => value !== null);
  const mappedColumns = (isRow ? [left, right] : [mapBound(left, kind, index), mapBound(right, kind, index)])
    .filter((value) => value !== null);
  if (mappedRows.length === 0 || mappedColumns.length === 0) return null;
  return `${cellName(Math.min(...mappedRows), Math.min(...mappedColumns))}:`
    + `${cellName(Math.max(...mappedRows), Math.max(...mappedColumns))}`;
}

/**
 * Shifts every cell, the selection, the validation ranges and the row/column count of
 * one worksheet. `index` is the 0-based coordinate of the target row/column.
 */
export function applyAxisChange(worksheet, axis, action, index) {
  const kind = structureKind(action);
  const isRow = axis === "row";
  const mapIndex = kind === "delete"
    ? (value) => (value === index ? null : value > index ? value - 1 : value)
    : (() => {
        const threshold = kind === "before" ? index : index + 1;
        return (value) => (value >= threshold ? value + 1 : value);
      })();

  const rowCount = worksheet.rowCount + (!isRow ? 0 : kind === "delete" ? -1 : 1);
  const columnCount = worksheet.columnCount + (isRow ? 0 : kind === "delete" ? -1 : 1);

  const cells = {};
  for (const [name, cell] of Object.entries(worksheet.cells ?? {})) {
    const position = parseCellName(name);
    if (!position) {
      cells[name] = cell;
      continue;
    }
    const row = isRow ? mapIndex(position.row) : position.row;
    const column = isRow ? position.column : mapIndex(position.column);
    if (row === null || column === null) continue;
    const shifted = { ...cell };
    if (typeof cell?.formula === "string" && cell.formula !== "") {
      shifted.formula = shiftFormula(cell.formula, { axis, action, index });
    }
    cells[cellName(row, column)] = shifted;
  }

  const clamp = (value, limit) => Math.max(0, Math.min(value, Math.max(limit - 1, 0)));
  const mapPoint = (name) => {
    const position = parseCellName(name);
    if (!position) return "A1";
    const row = isRow ? mapIndex(position.row) : position.row;
    const column = isRow ? position.column : mapIndex(position.column);
    return cellName(
      clamp(row ?? position.row, rowCount),
      clamp(column ?? position.column, columnCount),
    );
  };
  const selection = worksheet.selection ?? { anchor: "A1", focus: "A1" };

  const shifted = {
    ...worksheet,
    rowCount,
    columnCount,
    cells,
    selection: { anchor: mapPoint(selection.anchor ?? "A1"), focus: mapPoint(selection.focus ?? "A1") },
  };
  if (Array.isArray(worksheet.validations)) {
    shifted.validations = worksheet.validations
      .map((rule) => {
        const range = shiftValidationRange(rule?.range, { isRow, kind, index });
        return range ? { ...rule, range } : null;
      })
      .filter((rule) => rule !== null);
  }
  // The filter view follows the records it was created for; deleted columns drop out.
  if (worksheet.filter) {
    const filter = shiftFilter(worksheet.filter, { isRow, kind, index });
    if (filter) shifted.filter = filter;
    else delete shifted.filter;
  }
  return shifted;
}

export function applyRowChange(worksheet, action, index) {
  return applyAxisChange(worksheet, "row", action, index);
}

export function applyColumnChange(worksheet, action, index) {
  return applyAxisChange(worksheet, "column", action, index);
}

const REFERENCE_PATTERN = /(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]*)/y;
const PREVIOUS_IDENTIFIER = /[A-Za-z0-9_$.]/;
const NEXT_IDENTIFIER = /[A-Za-z0-9_]/;

function columnIndex(letters) {
  let index = 0;
  for (const character of letters.toUpperCase()) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  }
  return index - 1;
}

function isReferenceBoundary(segment, start, end) {
  const previous = start > 0 ? segment[start - 1] : "";
  const next = end < segment.length ? segment[end] : "";
  if (previous && PREVIOUS_IDENTIFIER.test(previous)) return false;
  if (next && NEXT_IDENTIFIER.test(next)) return false;
  // `LOG10(...)` is a function call, not the cell `LOG10`.
  if (next === "(") return false;
  return true;
}

function positionOf(match) {
  return { row: Number(match[4]) - 1, column: columnIndex(match[2]) };
}

function formatReference(match, position) {
  return `${match[1]}${columnLabel(position.column)}${match[3]}${position.row + 1}`;
}

function withAxis(position, axis, value) {
  return axis === "row" ? { row: value, column: position.column } : { row: position.row, column: value };
}

function shiftCoordinate(value, { kind, index }) {
  if (kind === "delete") {
    if (value === index) return null;
    return value > index ? value - 1 : value;
  }
  const threshold = kind === "before" ? index : index + 1;
  return value >= threshold ? value + 1 : value;
}

function shiftReference(position, spec) {
  const shifted = shiftCoordinate(position[spec.axis], spec);
  return shifted === null ? null : withAxis(position, spec.axis, shifted);
}

/**
 * A range keeps its shape when one of its edges is removed (the edge collapses onto the
 * surviving neighbour), and only becomes `#REF!` when every coordinate inside is gone.
 */
function shiftRange(firstMatch, secondMatch, spec) {
  if (spec.kind !== "delete") {
    const start = shiftReference(positionOf(firstMatch), spec);
    const end = shiftReference(positionOf(secondMatch), spec);
    return start && end
      ? `${formatReference(firstMatch, start)}:${formatReference(secondMatch, end)}`
      : "#REF!";
  }
  const startRef = positionOf(firstMatch);
  const endRef = positionOf(secondMatch);
  const start = startRef[spec.axis];
  const end = endRef[spec.axis];
  if (start === spec.index && end === spec.index) return "#REF!";
  // The removed coordinate is dropped from the covered set, so the upper edge shrinks.
  const mappedStart = spec.index < start ? start - 1 : start;
  const mappedEnd = spec.index <= end ? end - 1 : end;
  if (mappedStart > mappedEnd) return "#REF!";
  return `${formatReference(firstMatch, withAxis(startRef, spec.axis, mappedStart))}:`
    + `${formatReference(secondMatch, withAxis(endRef, spec.axis, mappedEnd))}`;
}

function shiftSegment(segment, spec) {
  let result = "";
  let index = 0;
  while (index < segment.length) {
    REFERENCE_PATTERN.lastIndex = index;
    const match = REFERENCE_PATTERN.exec(segment);
    if (!match || !isReferenceBoundary(segment, index, index + match[0].length)) {
      result += segment[index];
      index += 1;
      continue;
    }
    let end = index + match[0].length;
    let rangeEnd = null;
    if (segment[end] === ":") {
      REFERENCE_PATTERN.lastIndex = end + 1;
      const candidate = REFERENCE_PATTERN.exec(segment);
      if (candidate && isReferenceBoundary(segment, end + 1, end + 1 + candidate[0].length)) {
        rangeEnd = { match: candidate, end: end + 1 + candidate[0].length };
      }
    }
    if (rangeEnd) {
      result += shiftRange(match, rangeEnd.match, spec);
      index = rangeEnd.end;
      continue;
    }
    const shifted = shiftReference(positionOf(match), spec);
    result += shifted === null ? "#REF!" : formatReference(match, shifted);
    index = end;
  }
  return result;
}

/** Rewrites the A1 references of a formula after a row/column insertion or deletion. */
export function shiftFormula(formula, { axis, action, index }) {
  const text = String(formula ?? "");
  if (!text) return text;
  const spec = { axis: axis === "column" ? "column" : "row", kind: structureKind(action), index };
  // References inside quoted string literals are data, not coordinates.
  return text
    .split('"')
    .map((segment, position) => (position % 2 === 0 ? shiftSegment(segment, spec) : segment))
    .join('"');
}

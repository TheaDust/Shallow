import type { CellAddress, CellRegion } from "../lib/cells";
import type { WorksheetData } from "../workbooks/types";
import { computeFakeDisplays } from "./fakeFormula";

/**
 * Row and column structure of the fake server, mirroring `backend/src/lib/structure.mjs`: cells,
 * formula references, validation rules, the filter view and the selection move together, so the
 * frontend tests exercise the same shifted state the real server stores.
 */

export interface StructureChangeInput {
  axis: "row" | "column";
  op: "insert" | "delete";
  index: number;
  side: "before" | "after";
}

export function parseAddress(cellId: string): CellAddress | null {
  const match = /^([A-Za-z]{1,3})([1-9][0-9]{0,6})$/.exec(cellId);
  if (!match) return null;
  let column = 0;
  for (const character of match[1].toUpperCase()) column = column * 26 + (character.charCodeAt(0) - 64);
  return { row: Number(match[2]), column };
}

function columnLabel(column: number): string {
  let label = "";
  for (let rest = column; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    label = String.fromCharCode(65 + ((rest - 1) % 26)) + label;
  }
  return label;
}

export function cellId(row: number, column: number): string {
  return `${columnLabel(column)}${row}`;
}

/** Mirrors `movedIndex` of the server: new index of a row/column, or null when it was removed. */
function movedIndex(change: StructureChangeInput, value: number): number | null {
  if (change.op === "insert") {
    const boundary = change.side === "after" ? change.index + 1 : change.index;
    return value >= boundary ? value + 1 : value;
  }
  if (value === change.index) return null;
  return value > change.index ? value - 1 : value;
}

function movedStart(change: StructureChangeInput, value: number): number {
  if (change.op === "insert") return movedIndex(change, value) as number;
  return value > change.index ? value - 1 : value;
}

function movedEnd(change: StructureChangeInput, value: number): number {
  if (change.op === "insert") return movedIndex(change, value) as number;
  return value >= change.index ? value - 1 : value;
}

/** Rewrites the A1 references of a formula through a structural move, like the server does. */
function remapFormula(text: string, mapReference: (address: CellAddress) => CellAddress | null): string {
  if (!(text.length > 1 && text.startsWith("="))) return text;
  return `=${text.slice(1).replace(/(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]{0,6})(?![A-Za-z0-9_])/g, (match, columnDollar, columnText, rowDollar, rowText) => {
    let column = 0;
    for (const character of String(columnText).toUpperCase()) column = column * 26 + (character.charCodeAt(0) - 64);
    const moved = mapReference({ row: Number(rowText), column });
    if (!moved) return "#REF!";
    return `${columnDollar}${columnLabel(moved.column)}${rowDollar}${moved.row}`;
  })}`;
}

/** Mirrors `applyStructureChange` of the server on one worksheet. */
export function applyStructure(worksheet: WorksheetData, change: StructureChangeInput): void {
  const isRow = change.axis === "row";
  const moveRow = isRow ? (value: number) => movedIndex(change, value) : (value: number) => value;
  const moveColumn = isRow ? (value: number) => value : (value: number) => movedIndex(change, value);

  const cells: WorksheetData["cells"] = {};
  for (const [id, cell] of Object.entries(worksheet.cells)) {
    const address = parseAddress(id);
    if (!address) continue;
    const row = moveRow(address.row);
    const column = moveColumn(address.column);
    if (row === null || column === null) continue;
    const value = remapFormula(cell.value ?? "", (reference) => {
      const nextRow = moveRow(reference.row);
      const nextColumn = moveColumn(reference.column);
      if (nextRow === null || nextColumn === null) return null;
      return { row: nextRow, column: nextColumn };
    });
    if (value === "") continue;
    cells[cellId(row, column)] = { value };
  }
  worksheet.cells = computeFakeDisplays(cells);

  worksheet.validations = (worksheet.validations ?? [])
    .map((rule) => ({
      ...rule,
      range: {
        top: isRow ? movedStart(change, rule.range.top) : rule.range.top,
        bottom: isRow ? movedEnd(change, rule.range.bottom) : rule.range.bottom,
        left: isRow ? rule.range.left : movedStart(change, rule.range.left),
        right: isRow ? rule.range.right : movedEnd(change, rule.range.right),
      },
    }))
    .filter((rule) => rule.range.bottom >= rule.range.top && rule.range.right >= rule.range.left);

  const filter = worksheet.filter;
  if (filter) {
    const region: CellRegion = {
      top: isRow ? movedStart(change, filter.region.top) : filter.region.top,
      bottom: isRow ? movedEnd(change, filter.region.bottom) : filter.region.bottom,
      left: isRow ? filter.region.left : movedStart(change, filter.region.left),
      right: isRow ? filter.region.right : movedEnd(change, filter.region.right),
    };
    worksheet.filter =
      region.bottom < region.top || region.right < region.left
        ? null
        : {
            region,
            columns: filter.columns.flatMap((entry) => {
              const column = isRow ? entry.column : moveColumn(entry.column);
              if (column === null || column < region.left || column > region.right) return [];
              return [{ ...entry, column }];
            }),
          };
  }

  worksheet.rowCount += isRow && change.op === "insert" ? 1 : 0;
  worksheet.columnCount += !isRow && change.op === "insert" ? 1 : 0;

  const selection = worksheet.selection ?? { anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } };
  const move = (value: number) => movedIndex(change, value) ?? change.index;
  const clamp = (value: number, limit: number) => Math.min(Math.max(value, 1), Math.max(limit, 1));
  worksheet.selection = isRow
    ? {
        anchor: { ...selection.anchor, row: clamp(move(selection.anchor.row), worksheet.rowCount) },
        focus: { ...selection.focus, row: clamp(move(selection.focus.row), worksheet.rowCount) },
      }
    : {
        anchor: { ...selection.anchor, column: clamp(move(selection.anchor.column), worksheet.columnCount) },
        focus: { ...selection.focus, column: clamp(move(selection.focus.column), worksheet.columnCount) },
      };
}

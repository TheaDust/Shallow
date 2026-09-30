import { A1, clampCell, isInRegion, makeCellId, regionOf, type CellAddress, type CellRegion } from "../lib/cells";
import type { GridSelectionData, WorksheetData } from "../workbooks/types";

/** The rectangle selected in one worksheet: `anchor` is where the selection started, `focus` the active cell. */
export interface GridSelection {
  anchor: CellAddress;
  focus: CellAddress;
}

export const INITIAL_SELECTION: GridSelection = { anchor: A1, focus: A1 };

export function selectionRegion(selection: GridSelection): CellRegion {
  return regionOf(selection.anchor, selection.focus);
}

export function isCellSelected(selection: GridSelection, address: CellAddress): boolean {
  return isInRegion(selectionRegion(selection), address);
}

export function selectionCellCount(selection: GridSelection): number {
  const region = selectionRegion(selection);
  return (region.bottom - region.top + 1) * (region.right - region.left + 1);
}

export function currentCellId(selection: GridSelection): string {
  return makeCellId(selection.focus.row, selection.focus.column);
}

export function startAddress(selection: GridSelection): CellAddress {
  const region = selectionRegion(selection);
  return { row: region.top, column: region.left };
}

export function clampSelection(selection: GridSelection, worksheet: WorksheetData): GridSelection {
  return {
    anchor: clampCell(selection.anchor, worksheet.rowCount, worksheet.columnCount),
    focus: clampCell(selection.focus, worksheet.rowCount, worksheet.columnCount),
  };
}

/** The selection saved for a worksheet, falling back to A1 for worksheets that never were selected. */
export function selectionOfWorksheet(worksheet: WorksheetData): GridSelection {
  const stored = worksheet.selection;
  if (!stored || !isAddress(stored.anchor) || !isAddress(stored.focus)) return INITIAL_SELECTION;
  return clampSelection({ anchor: stored.anchor, focus: stored.focus }, worksheet);
}

export function selectionPayload(selection: GridSelection): GridSelectionData {
  return {
    anchor: { row: selection.anchor.row, column: selection.anchor.column },
    focus: { row: selection.focus.row, column: selection.focus.column },
  };
}

function isAddress(value: CellAddress | undefined | null): value is CellAddress {
  if (!value) return false;
  return Number.isInteger(value.row) && Number.isInteger(value.column) && value.row >= 1 && value.column >= 1;
}

import { cellAddress, parseCellAddress } from "./coordinates";

export interface CellSelection {
  /** The current cell of the selection. */
  anchor: string;
  /** The opposite corner of the selected rectangular region. */
  focus: string;
}

export interface SelectionBounds {
  topRow: number;
  bottomRow: number;
  leftColumn: number;
  rightColumn: number;
}

export function singleCellSelection(address: string): CellSelection {
  return { anchor: address, focus: address };
}

export function selectionBounds(selection: CellSelection): SelectionBounds {
  const anchor = parseCellAddress(selection.anchor);
  const focus = parseCellAddress(selection.focus) ?? anchor;
  if (!anchor || !focus) return { topRow: 1, bottomRow: 1, leftColumn: 1, rightColumn: 1 };
  return {
    topRow: Math.min(anchor.row, focus.row),
    bottomRow: Math.max(anchor.row, focus.row),
    leftColumn: Math.min(anchor.column, focus.column),
    rightColumn: Math.max(anchor.column, focus.column),
  };
}

export function isCellSelected(bounds: SelectionBounds, address: string): boolean {
  const coordinate = parseCellAddress(address);
  if (!coordinate) return false;
  return (
    coordinate.row >= bounds.topRow &&
    coordinate.row <= bounds.bottomRow &&
    coordinate.column >= bounds.leftColumn &&
    coordinate.column <= bounds.rightColumn
  );
}

/**
 * Selection rectangle stored with a worksheet. Only the anchor used to be kept;
 * a worksheet without a stored focus falls back to its single cell so an older
 * entry still opens with a usable selection.
 */
export function selectionFromWorksheet(worksheet: {
  activeCell?: string;
  selectionFocus?: string;
}): CellSelection {
  const anchor = worksheet.activeCell || "A1";
  return { anchor, focus: worksheet.selectionFocus || anchor };
}

/** Top-left coordinate of the rectangle; where a paste or a range operation starts. */
export function selectionStart(selection: CellSelection): string {
  const bounds = selectionBounds(selection);
  return cellAddress(bounds.leftColumn, bounds.topRow);
}

/** True when both corners of the rectangle are the same pair of coordinates. */
export function sameSelection(left: CellSelection, right: CellSelection): boolean {
  return left.anchor === right.anchor && left.focus === right.focus;
}

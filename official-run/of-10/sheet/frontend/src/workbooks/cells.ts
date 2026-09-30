import type { WorksheetData } from "./types";

/** Text the formula bar shows for a cell: the submitted value or the original formula. */
export function rawCellText(worksheet: WorksheetData | undefined, cellId: string): string {
  return worksheet?.cells[cellId]?.value ?? "";
}

/** Text the grid shows for a cell: the calculated result of a formula, otherwise the raw text. */
export function displayedCellText(worksheet: WorksheetData | undefined, cellId: string): string {
  const cell = worksheet?.cells[cellId];
  if (!cell) return "";
  return cell.display ?? cell.value ?? "";
}

/** True when the submitted text is a formula (the cell stores the original expression). */
export function isFormulaCell(worksheet: WorksheetData | undefined, cellId: string): boolean {
  const value = worksheet?.cells[cellId]?.value ?? "";
  return value.length > 1 && value.startsWith("=");
}

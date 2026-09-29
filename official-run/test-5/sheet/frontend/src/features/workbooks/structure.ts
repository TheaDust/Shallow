/** Row/column structure commands offered by the grid header menus. */

export type StructureAxis = "row" | "column";

export type RowOperation = "insert-row-above" | "insert-row-below" | "delete-row";
export type ColumnOperation = "insert-column-left" | "insert-column-right" | "delete-column";
export type StructureOperation = RowOperation | ColumnOperation;

export const INSERT_ROW_ABOVE = "insert-row-above";
export const INSERT_ROW_BELOW = "insert-row-below";
export const DELETE_ROW = "delete-row";
export const INSERT_COLUMN_LEFT = "insert-column-left";
export const INSERT_COLUMN_RIGHT = "insert-column-right";
export const DELETE_COLUMN = "delete-column";

export const INSERT_ROW_ABOVE_LABEL = "Insert 1 row above";
export const INSERT_ROW_BELOW_LABEL = "Insert 1 row below";
export const DELETE_ROW_LABEL = "Delete row";
export const INSERT_COLUMN_LEFT_LABEL = "Insert 1 column left";
export const INSERT_COLUMN_RIGHT_LABEL = "Insert 1 column right";
export const DELETE_COLUMN_LABEL = "Delete column";

export interface StructureCommand {
  operation: StructureOperation;
  label: string;
}

/** Commands of the row-number menu, in display order. */
export const ROW_COMMANDS: readonly StructureCommand[] = [
  { operation: INSERT_ROW_ABOVE, label: INSERT_ROW_ABOVE_LABEL },
  { operation: INSERT_ROW_BELOW, label: INSERT_ROW_BELOW_LABEL },
  { operation: DELETE_ROW, label: DELETE_ROW_LABEL },
];

/** Commands of the column-header menu, in display order. */
export const COLUMN_COMMANDS: readonly StructureCommand[] = [
  { operation: INSERT_COLUMN_LEFT, label: INSERT_COLUMN_LEFT_LABEL },
  { operation: INSERT_COLUMN_RIGHT, label: INSERT_COLUMN_RIGHT_LABEL },
  { operation: DELETE_COLUMN, label: DELETE_COLUMN_LABEL },
];

/** Accessible name of the row-number menu. */
export function rowMenuLabel(row: number): string {
  return `Row ${row} menu`;
}

/** Accessible name of the column-header menu. */
export function columnMenuLabel(column: string): string {
  return `Column ${column} menu`;
}

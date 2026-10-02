/** Row/column structure operations triggered from the header menus of the active worksheet. */

export type RowStructureAction = "insert-above" | "insert-below" | "delete";
export type ColumnStructureAction = "insert-left" | "insert-right" | "delete";

export interface RowStructureOperation {
  axis: "row";
  /** Zero-based row index of the target row. */
  index: number;
  action: RowStructureAction;
}

export interface ColumnStructureOperation {
  axis: "column";
  /** Zero-based column index of the target column. */
  index: number;
  action: ColumnStructureAction;
}

export type StructureOperation = RowStructureOperation | ColumnStructureOperation;

export const ROW_MENU_ITEMS: ReadonlyArray<{ action: RowStructureAction; label: string }> = [
  { action: "insert-above", label: "Insert 1 row above" },
  { action: "insert-below", label: "Insert 1 row below" },
  { action: "delete", label: "Delete row" },
];

export const COLUMN_MENU_ITEMS: ReadonlyArray<{ action: ColumnStructureAction; label: string }> = [
  { action: "insert-left", label: "Insert 1 column left" },
  { action: "insert-right", label: "Insert 1 column right" },
  { action: "delete", label: "Delete column" },
];

export const STRUCTURE_BUSY_MESSAGE = "Updating worksheet structure…";
export const STRUCTURE_FAILURE_MESSAGE = "Unable to update the worksheet structure";

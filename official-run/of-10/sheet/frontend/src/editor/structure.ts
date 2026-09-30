/**
 * Commands of the row-number and column-header menus (REQ-2-2). Both menus are opened by
 * right-clicking the header of the current active worksheet; each command names the axis change the
 * server applies to that worksheet and keeps its row numbers, column letters and records in step.
 */

export type StructureAxis = "row" | "column";
export type StructureOperation = "insert" | "delete";
export type StructureSide = "before" | "after";

export interface StructureCommand {
  id: string;
  label: string;
  op: StructureOperation;
  /** Where an insertion places the blank row/column relative to the target; unused when deleting. */
  side: StructureSide;
}

export const ROW_COMMANDS: readonly StructureCommand[] = [
  { id: "insert-row-above", label: "Insert 1 row above", op: "insert", side: "before" },
  { id: "insert-row-below", label: "Insert 1 row below", op: "insert", side: "after" },
  { id: "delete-row", label: "Delete row", op: "delete", side: "before" },
];

export const COLUMN_COMMANDS: readonly StructureCommand[] = [
  { id: "insert-column-left", label: "Insert 1 column left", op: "insert", side: "before" },
  { id: "insert-column-right", label: "Insert 1 column right", op: "insert", side: "after" },
  { id: "delete-column", label: "Delete column", op: "delete", side: "before" },
];

export function commandsOf(axis: StructureAxis): readonly StructureCommand[] {
  return axis === "row" ? ROW_COMMANDS : COLUMN_COMMANDS;
}

/** Payload of the structure endpoint: which row/column changes and how. */
export interface StructureChangeRequest {
  axis: StructureAxis;
  op: StructureOperation;
  /** 1-based row number or column index of the target header. */
  index: number;
  side?: StructureSide;
}

export function structureChangeOf(
  axis: StructureAxis,
  command: StructureCommand,
  index: number,
): StructureChangeRequest {
  return { axis, op: command.op, index, side: command.side };
}

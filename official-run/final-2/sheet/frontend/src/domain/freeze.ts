/**
 * Frozen panes of a worksheet: how many leading rows and columns stay visible.
 *
 * The three "View" menu commands each describe a whole freeze state, so they
 * are derived from the top-left cell of the current selection:
 *
 * - "Freeze rows through N" freezes every row through the selected row.
 * - "Freeze columns through L" freezes every column through the selected column.
 * - "Freeze panes at C4" freezes the rows above and the columns to the left.
 *
 * The counts of the state are what the editor shows and what the server stores,
 * so the button label and the persisted state never disagree.
 */

import { cellName, columnName, parseCellName } from "./grid";
import type { WorksheetFreeze } from "./types";

/** The three freeze commands offered by the "View" menu. */
export type FreezeCommand = "rows" | "columns" | "panes";

/** State of a worksheet whose headings are not frozen. */
export const NO_FREEZE: WorksheetFreeze = { rows: 0, columns: 0 };

/** Frozen pane counts one menu command produces for the selected cell. */
export function freezeCounts(command: FreezeCommand, coordinate: string): WorksheetFreeze {
  const position = parseCellName(coordinate) ?? { row: 1, column: 1 };
  switch (command) {
    case "rows":
      return { rows: position.row, columns: 0 };
    case "columns":
      return { rows: 0, columns: position.column };
    default:
      return { rows: Math.max(0, position.row - 1), columns: Math.max(0, position.column - 1) };
  }
}

/** Exact label of the editor's frozen-pane button for a stored state. */
export function freezeLabel(freeze?: WorksheetFreeze | null): string {
  return `Frozen rows: ${freeze?.rows ?? 0}; columns: ${freeze?.columns ?? 0}`;
}

/** True while some heading of the worksheet is frozen. */
export function isFrozen(freeze?: WorksheetFreeze | null): boolean {
  return Boolean(freeze && (freeze.rows > 0 || freeze.columns > 0));
}

export interface FreezeMenuItem {
  id: FreezeCommand;
  label: string;
}

/**
 * Items of the "View" menu for the current selection, in the order the menu
 * offers them. Each label names the selected row, column or coordinate, so the
 * command a viewer picks reads exactly like the heading it freezes.
 */
export function freezeMenuItems(coordinate: string): FreezeMenuItem[] {
  const position = parseCellName(coordinate) ?? { row: 1, column: 1 };
  return [
    { id: "rows", label: `Freeze rows through ${position.row}` },
    { id: "columns", label: `Freeze columns through ${columnName(position.column)}` },
    { id: "panes", label: `Freeze panes at ${cellName(position.row, position.column)}` },
  ];
}

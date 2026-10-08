/**
 * Frozen panes of one worksheet: how many leading rows and columns stay in
 * place while the rest of the grid scrolls. The counts are persisted per
 * worksheet (see `Worksheet.frozenRows`/`frozenColumns`), so they survive a
 * refresh, and the editor mirrors them in a button whose name is exactly
 * `Frozen rows: <count>; columns: <count>`.
 */

import { columnName } from "./grid";
import type { Worksheet } from "./types";

export interface FrozenPanes {
  rows: number;
  columns: number;
}

/** No frozen panes: the whole grid scrolls. */
export const NO_FROZEN_PANES: FrozenPanes = { rows: 0, columns: 0 };

/** Stored freeze counts of one worksheet, defaulting to none. */
export function frozenPanesOf(worksheet: Pick<Worksheet, "frozenRows" | "frozenColumns">): FrozenPanes {
  return {
    rows: Math.max(0, Math.trunc(worksheet.frozenRows ?? 0)),
    columns: Math.max(0, Math.trunc(worksheet.frozenColumns ?? 0)),
  };
}

/** Accessible name of the button exposing the saved freeze state. */
export function frozenPanesLabel(frozen: FrozenPanes): string {
  return `Frozen rows: ${frozen.rows}; columns: ${frozen.columns}`;
}

/** "Freeze rows through <row number>": every row through the selected row. */
export function freezeRowsLabel(row: number): string {
  return `Freeze rows through ${row}`;
}

/** "Freeze columns through <column letters>": every column through the selected column. */
export function freezeColumnsLabel(column: number): string {
  return `Freeze columns through ${columnName(column)}`;
}

/** "Freeze panes at <cell coordinate>". */
export function freezePanesLabel(coordinate: string): string {
  return `Freeze panes at ${coordinate}`;
}

/** Rows above and columns to the left of a cell, as the freeze counts. */
export function panesAboveAndLeft(position: { row: number; column: number }): FrozenPanes {
  return { rows: Math.max(0, position.row - 1), columns: Math.max(0, position.column - 1) };
}

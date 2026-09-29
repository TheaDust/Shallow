/** Pure helpers of grid cell editing: labels, clipboard tables and cell menus. */

import { cellAddress, parseCellAddress } from "./coordinates";

/** Accessible name of the inline text box of a grid cell. */
export function cellEditorLabel(address: string): string {
  return `Edit ${address}`;
}

/** Accessible name of the cell context menu. */
export function cellMenuLabel(address: string): string {
  return `Cell ${address} menu`;
}

/** Command id and accessible name of the grid menu's paste command. */
export const PASTE_COMMAND = "paste";
export const PASTE_COMMAND_LABEL = "Paste";

/**
 * Splits clipboard text into rows of tab-separated columns. A trailing newline
 * only terminates the last row instead of adding an empty one; empty fields
 * between tabs are preserved.
 */
export function parseClipboardTable(text: string): string[][] {
  if (typeof text !== "string" || text === "") return [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => line.split("\t"));
}

/**
 * Raw texts of a pasted table placed with its first cell at `startAddress`.
 * Returns null when the start address is not a cell coordinate.
 */
export function tableToCellUpdates(
  startAddress: string,
  table: readonly (readonly string[])[],
): Record<string, string> | null {
  const start = parseCellAddress(startAddress);
  if (!start || table.length === 0) return null;
  const updates: Record<string, string> = {};
  table.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      updates[cellAddress(start.column + columnIndex, start.row + rowIndex)] = value;
    });
  });
  return updates;
}

/** Clipboard content of a pasted table, used when the clipboard is unreadable. */
export const CLIPBOARD_UNAVAILABLE_MESSAGE = "The clipboard could not be read. Use Ctrl+V to paste.";
export const EMPTY_CLIPBOARD_MESSAGE = "There is nothing to paste.";

/**
 * True while the event comes from a text box or another native form control:
 * those keep their own editing shortcuts (typing, native undo, native paste).
 */
export function isFormControl(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT";
}

/**
 * Best-effort write into the browser clipboard, so Ctrl+C also leaves the
 * rectangle available to other applications. The remembered range stays the
 * authoritative source when the browser refuses the write (no permission, no
 * clipboard API): pasting inside the application keeps working either way.
 */
export function writeClipboardText(text: string): void {
  try {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    const pending = clipboard?.writeText?.(text);
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  } catch {
    // Ignored on purpose: the remembered range is what a paste inside the app uses.
  }
}

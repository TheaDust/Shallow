import type { CellRange } from "./types";

/** The in-app clipboard buffer mirrors the system clipboard for range copy/cut. */
export interface ClipboardBuffer {
  sheetId: string;
  source: CellRange;
  mode: "copy" | "cut";
}

let buffer: ClipboardBuffer | null = null;
let lastExternalText: string | null = null;

export function setClipboardBuffer(value: ClipboardBuffer | null): void {
  buffer = value;
}

export function getClipboardBuffer(): ClipboardBuffer | null {
  return buffer;
}

export function clearClipboardBuffer(): void {
  buffer = null;
}

export function setLastExternalText(text: string | null): void {
  lastExternalText = text;
}

export function getLastExternalText(): string | null {
  return lastExternalText;
}

/**
 * Splits clipboard text into rows/columns. Tab separates columns, newline
 * separates rows; a single trailing newline is a separator, not an empty row.
 */
export function parsePasteText(text: string): string[][] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => line.split("\t"));
}

/** Serializes a 2-D table into tab/newline separated clipboard text. */
export function serializePasteText(rows: string[][]): string {
  return rows.map((row) => row.join("\t")).join("\n");
}

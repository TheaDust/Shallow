import { REF_ERROR } from "./formula";
import {
  cellName,
  columnLabel,
  isWithinRegion,
  parseCellName,
  type CellRef,
  type CellRegion,
  type Worksheet,
} from "./workbook";

/**
 * Copy/cut/paste of a rectangular range inside one worksheet (REQ-3-2-1).
 *
 * The clipboard keeps the *original submitted text* of every source cell (the
 * same text `worksheet.cells` stores), so a paste writes values verbatim and
 * copies formulas with adjusted relative references. Nothing here writes to the
 * server: the caller sends one cell batch, which is what makes a transfer
 * atomic (source, target and affected formulas update together or not at all).
 */
export type RangeTransferMode = "copy" | "cut";

export interface RangeClipboard {
  workbookId: string;
  worksheetId: string;
  mode: RangeTransferMode;
  region: CellRegion;
  /** Row-major raw text of the source rectangle; `""` for an empty source cell. */
  table: string[][];
}

/** Rectangle covered by a table pasted at `target` (its top-left coordinate). */
export function targetRegion(clip: RangeClipboard, target: CellRef): CellRegion {
  const rows = clip.table.length;
  const cols = clip.table.reduce((widest, row) => Math.max(widest, row.length), 0);
  return {
    minRow: target.row,
    maxRow: target.row + Math.max(rows - 1, 0),
    minCol: target.col,
    maxCol: target.col + Math.max(cols - 1, 0),
  };
}

/** Raw stored text of every cell of the rectangle, row-major (empties as `""`). */
export function readRegion(worksheet: Worksheet, region: CellRegion): string[][] {
  const table: string[][] = [];
  for (let row = region.minRow; row <= region.maxRow; row += 1) {
    const values: string[] = [];
    for (let col = region.minCol; col <= region.maxCol; col += 1) {
      values.push(worksheet.cells[cellName({ row, col })] ?? "");
    }
    table.push(values);
  }
  return table;
}

/** Tab-separated text of a table: what the grid offers to the system clipboard. */
export function tableToTsv(table: readonly (readonly string[])[]): string {
  return table.map((row) => row.join("\t")).join("\n");
}

/**
 * A1-style reference inside a formula, optionally a `A1:B2` pair. The absolute
 * markers are captured apart from the letters/digits so `$`-anchored parts
 * survive a move untouched, and the lookarounds keep function names (`LOG10`)
 * and text out of the match.
 */
const REFERENCE = /(?<![A-Za-z0-9_])(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]*)(?::(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]*))?(?![A-Za-z0-9_(])/g;

/** One endpoint rendered for the target offset, or `null` once it leaves A1. */
function offsetPoint(
  letters: string,
  digits: string,
  absCol: string,
  absRow: string,
  rowDelta: number,
  colDelta: number,
): string | null {
  const ref = parseCellName(`${letters}${digits}`);
  if (!ref) return null;
  const row = ref.row + (absRow ? 0 : rowDelta);
  const col = ref.col + (absCol ? 0 : colDelta);
  if (row < 0 || col < 0) return null;
  return `${absCol}${columnLabel(col)}${absRow}${row + 1}`;
}

/**
 * Offset formula text for a copy/move: relative references shift by the target
 * offset while absolute (`$`) references stay as written (REQ-4-1-2).
 *
 * A reference that the offset would push outside the sheet cannot be kept, and
 * neither can a rectangle whose endpoint leaves the sheet (`A1:A3` copied up is
 * not representable either), so the whole formula becomes `=#REF!`: the target
 * formula bar then shows `=#REF!` and the grid shows `#REF!` instead of a
 * half-invalid expression such as `=#REF!+A1` or `#REF!:A2`.
 */
export function translateFormula(text: string, rowDelta: number, colDelta: number): string {
  if (typeof text !== "string" || !text.startsWith("=")) return text;
  if (rowDelta === 0 && colDelta === 0) return text;
  let invalid = false;
  const translated = text.replace(
    REFERENCE,
    (match, absCol: string, letters: string, absRow: string, digits: string,
      absCol2?: string, letters2?: string, absRow2?: string, digits2?: string) => {
      const first = offsetPoint(letters, digits, absCol, absRow, rowDelta, colDelta);
      const second = letters2 === undefined || digits2 === undefined
        ? null
        : offsetPoint(letters2, digits2, absCol2 ?? "", absRow2 ?? "", rowDelta, colDelta);
      if (!first || (letters2 !== undefined && !second)) {
        invalid = true;
        return match;
      }
      return second ? `${first}:${second}` : first;
    },
  );
  return invalid ? `=${REF_ERROR}` : translated;
}

/**
 * Offset of a paste: the target's top-left corner relative to the source
 * rectangle. Every cell of the rectangle moves by this same offset, which is
 * what makes relative references adjust by the target offset.
 */
export function translationDeltas(clip: RangeClipboard, target: CellRef): { rowDelta: number; colDelta: number } {
  return {
    rowDelta: target.row - clip.region.minRow,
    colDelta: target.col - clip.region.minCol,
  };
}

/** Source table with every formula adjusted for the paste offset. */
export function translatedTable(clip: RangeClipboard, target: CellRef): string[][] {
  const { rowDelta, colDelta } = translationDeltas(clip, target);
  return clip.table.map((row) => row.map((value) => translateFormula(value, rowDelta, colDelta)));
}

/**
 * One atomic cell batch for a range paste. The whole target rectangle is written
 * (empty source fields clear their target cell) with formulas translated for the
 * offset; a cut additionally clears the source rectangle, except for cells the
 * target rectangle covers, which the moved values overwrite.
 */
export function transferCells(clip: RangeClipboard, target: CellRef): Record<string, string | null> {
  const region = targetRegion(clip, target);
  const table = translatedTable(clip, target);
  const cells: Record<string, string | null> = {};
  if (clip.mode === "cut") {
    for (let row = clip.region.minRow; row <= clip.region.maxRow; row += 1) {
      for (let col = clip.region.minCol; col <= clip.region.maxCol; col += 1) {
        const ref = { row, col };
        if (!isWithinRegion(ref, region)) cells[cellName(ref)] = null;
      }
    }
  }
  table.forEach((values, rowOffset) => {
    values.forEach((value, colOffset) => {
      const name = cellName({ row: target.row + rowOffset, col: target.col + colOffset });
      cells[name] = value === "" ? null : value;
    });
  });
  return cells;
}

/** True when external clipboard text is this internal clipboard's own payload. */
export function clipboardMatchesText(clip: RangeClipboard, text: string): boolean {
  return text === tableToTsv(clip.table);
}

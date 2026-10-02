import { useRef, useState } from "react";

import { parseClipboardTable, tableToCellPatch } from "../domain/clipboard";
import type { WorksheetSnapshot } from "../domain/history";
import { snapshotWorksheet } from "../domain/history";
import {
  clipboardMatchesText,
  readRegion,
  tableToTsv,
  targetRegion,
  transferCells,
  translatedTable,
  type RangeClipboard,
  type RangeTransferMode,
} from "../domain/range-transfer";
import { selectionRegion, type Selection, type Workbook, type Worksheet } from "../domain/workbook";
import { messageOf } from "../lib/api";

/** Only same-worksheet transfers are supported (REQ-3-2-1). */
export const SAME_WORKSHEET_MESSAGE = "Copying and pasting is only supported within the same worksheet.";

/** Best-effort system clipboard write; the internal clipboard never depends on it. */
export function writeClipboardText(text: string): void {
  try {
    const written = navigator.clipboard?.writeText?.(text);
    if (written && typeof written.catch === "function") void written.catch(() => {});
  } catch {
    // Writing needs permission; the app's own clipboard still performs the paste.
  }
}

export interface RangeClipboardDeps {
  workbookId: string;
  /** Active worksheet, or null while the workbook is still loading. */
  worksheet: Worksheet | null;
  selection: Selection;
  /** True while a cell draft is open: copy/cut then belongs to the text control. */
  hasOpenDraft(): boolean;
  /** One atomic cell batch against the server; the response is authoritative. */
  saveCells(worksheetId: string, cells: Record<string, string | null>): Promise<Workbook>;
  recordHistory(label: string, worksheetId: string, before: WorksheetSnapshot, updated: Workbook): void;
  setWorkbook(workbook: Workbook): void;
  setNotice(notice: string | null): void;
  setSelection(selection: Selection): void;
  /** Persists the complete target rectangle of a successful paste. */
  persistSelection(worksheetId: string, selection: Selection): void;
}

export interface RangeClipboardApi {
  /** Raw-range copy/cut for the grid's clipboard events ("" while a draft is open). */
  captureSelection(mode: RangeTransferMode): string;
  /** Toolbar copy/cut: the app range is also offered to the system clipboard. */
  copyToSystem(mode: RangeTransferMode): void;
  /** Ctrl+V / browser paste with the system clipboard text. */
  pasteEvent(text: string): void;
  /** Toolbar or cell-menu "Paste": app clipboard first, then the system clipboard. */
  pasteFromControl(): void;
  /** Labelled paste box: one two-dimensional text table. */
  pasteTextIntoGrid(text: string): void;
  /** Open state of the labelled paste box (used when the clipboard cannot be read). */
  pasteOpen: boolean;
  pasteText: string;
  setPasteOpen(open: boolean): void;
}

/**
 * Copy/cut/paste of a rectangular range for one editor session (REQ-3-1-2,
 * REQ-3-2-1, REQ-3-2-2).
 *
 * The app keeps the raw source rectangle and its `worksheetId` in its own
 * clipboard, so a paste can move values and translate formulas and a rectangle
 * copied in another worksheet is refused. Every write is one atomic cell batch
 * against the server: a rejected batch leaves the target (and a cut source)
 * exactly as they were, and only a successful batch records history and moves
 * the selection.
 */
export function useRangeClipboard(deps: RangeClipboardDeps): RangeClipboardApi {
  const { workbookId, worksheet, selection, saveCells, recordHistory } = deps;
  const clipboardRef = useRef<RangeClipboard | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  /**
   * Applies external clipboard text (REQ-3-1-2) as one atomic batch starting at
   * the top-left of the current selection.
   */
  const pasteTextIntoGrid = async (text: string) => {
    const sheet = worksheet;
    if (!sheet) return;
    const table = parseClipboardTable(text);
    if (table.length === 0) return;
    const region = selectionRegion(selection);
    const cells = tableToCellPatch({ row: region.minRow, col: region.minCol }, table);
    const before = snapshotWorksheet(sheet);
    try {
      const updated = await saveCells(sheet.id, cells);
      recordHistory("paste", sheet.id, before, updated);
      deps.setWorkbook(updated);
      deps.setNotice(null);
    } catch (error) {
      deps.setNotice(messageOf(error, "Could not paste the data."));
    }
  };

  /**
   * Copies or cuts the selected rectangle (REQ-3-2-1). A cut only marks the
   * source: it is cleared by the paste batch, never here. Returns "" while a
   * cell draft is open, so typing a cell keeps the browser's own copy of the
   * text control.
   */
  const captureSelection = (mode: RangeTransferMode): string => {
    const sheet = worksheet;
    if (!sheet || deps.hasOpenDraft()) return "";
    const region = selectionRegion(selection);
    const table = readRegion(sheet, region);
    clipboardRef.current = { workbookId, worksheetId: sheet.id, mode, region, table };
    return tableToTsv(table);
  };

  const copyToSystem = (mode: RangeTransferMode) => {
    const text = captureSelection(mode);
    if (text) writeClipboardText(text);
  };

  /**
   * Applies the app clipboard to the top-left of the current selection in one
   * cell batch: the target rectangle (with translated formulas) and, for a cut,
   * the cleared source update together or not at all. The selection then shows
   * the complete target rectangle, which is also persisted.
   */
  const applyTransfer = async (clip: RangeClipboard) => {
    const sheet = worksheet;
    if (!sheet) return;
    const region = selectionRegion(selection);
    const target = { row: region.minRow, col: region.minCol };
    const cells = transferCells(clip, target);
    const before = snapshotWorksheet(sheet);
    try {
      const updated = await saveCells(sheet.id, cells);
      recordHistory(clip.mode === "cut" ? "cut and paste" : "copy and paste", sheet.id, before, updated);
      deps.setWorkbook(updated);
      deps.setNotice(null);
      const pasted = targetRegion(clip, target);
      const next: Selection = {
        anchor: { row: pasted.minRow, col: pasted.minCol },
        focus: { row: pasted.maxRow, col: pasted.maxCol },
      };
      deps.setSelection(next);
      deps.persistSelection(sheet.id, next);
      // A moved rectangle is a plain copy from now on: its source is empty and
      // its text is already written at the pasted coordinates.
      clipboardRef.current = clip.mode === "cut"
        ? { ...clip, mode: "copy", region: pasted, table: translatedTable(clip, target) }
        : clip;
    } catch (error) {
      // The rejected batch left the target and the (cut) source untouched.
      deps.setNotice(messageOf(error, "Could not paste the data."));
    }
  };

  /** Applies the app clipboard, refusing a rectangle copied in another worksheet. */
  const applyInternalClipboard = async (clip: RangeClipboard) => {
    if (!worksheet) return;
    if (clip.workbookId !== workbookId || clip.worksheetId !== worksheet.id) {
      deps.setNotice(SAME_WORKSHEET_MESSAGE);
      return;
    }
    await applyTransfer(clip);
  };

  /**
   * Paste event path (Ctrl+V / the browser menu). The app clipboard wins when it
   * holds a range of this worksheet together with its own payload (or when the
   * system clipboard is empty); otherwise the external clipboard text is pasted
   * as a two-dimensional table. An empty paste without an app clipboard is
   * ignored rather than replaced by the paste box.
   */
  const pasteEvent = (text: string) => {
    const clip = clipboardRef.current;
    if (clip && (text === "" || clipboardMatchesText(clip, text))) {
      void applyInternalClipboard(clip);
      return;
    }
    if (text) void pasteTextIntoGrid(text);
  };

  /**
   * Toolbar / cell menu "Paste": the app's own copied rectangle when there is
   * one, otherwise the system clipboard (falling back to the labelled box when
   * the clipboard cannot be read).
   */
  const pasteFromControl = async () => {
    const clip = clipboardRef.current;
    if (clip) {
      await applyInternalClipboard(clip);
      return;
    }
    let text: string | null = null;
    try {
      const read = await navigator.clipboard?.readText?.();
      if (typeof read === "string") text = read;
    } catch {
      text = null;
    }
    if (text) {
      await pasteTextIntoGrid(text);
      return;
    }
    setPasteText("");
    setPasteOpen(true);
  };

  return {
    captureSelection,
    copyToSystem,
    pasteEvent,
    pasteFromControl: () => { void pasteFromControl(); },
    pasteTextIntoGrid: (text: string) => { void pasteTextIntoGrid(text); },
    pasteOpen,
    pasteText,
    setPasteOpen,
  };
}

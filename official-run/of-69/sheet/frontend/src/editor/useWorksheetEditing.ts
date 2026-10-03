import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { ApiError } from "../lib/api";
import { clipboardUpdates } from "../domain/clipboard";
import {
  saveWorksheetSelection,
  transferWorksheetRange,
  writeWorksheetCells,
} from "../domain/workbook-api";
import {
  activeCellName,
  sameSelection,
  snapshotWorksheet,
  type Selection,
  type Workbook,
  type Worksheet,
} from "../domain/types";

/** Text being edited for one cell, and where the user started editing it. */
export interface CellDraft {
  cell: string;
  input: string;
  source: "grid" | "formula";
}

/** A copied or cut rectangle waiting to be pasted in the same worksheet. */
export interface RangeClipboard {
  worksheetId: string;
  mode: "copy" | "cut";
  source: Selection;
}

export interface WorksheetEditingOptions {
  workbook: Workbook | null;
  worksheet: Worksheet | null;
  setWorkbook: Dispatch<SetStateAction<Workbook | null>>;
  /** Called after each successful mutation so the undo history can record it. */
  onRecord?(worksheetId: string, before: ReturnType<typeof snapshotWorksheet>, after: ReturnType<typeof snapshotWorksheet>): void;
}

export interface WorksheetEditing {
  draft: CellDraft | null;
  pending: boolean;
  error: string;
  /** Text shown by the "Formula bar": the draft while editing, otherwise the cell content. */
  formulaBarValue: string;
  /** Internal copy/cut clipboard, when one is set for the active worksheet. */
  clipboard: RangeClipboard | null;
  hasInternalRange: boolean;
  beginGridEdit(cell: string, input: string): void;
  updateDraft(input: string): void;
  commit(selection?: Selection): void;
  cancel(): void;
  select(selection: Selection): void;
  /** Writes one committed value (for example a dropdown choice) into a cell. */
  setValue(cell: string, input: string): void;
  paste(startCell: string, text: string): void;
  pasteFromClipboard(startCell: string): void;
  copyRange(): void;
  cutRange(): void;
  pasteRangeInternal(startCell: string): void;
}

export const CLIPBOARD_READ_ERROR = "Unable to read the clipboard.";
export const CELL_SAVE_ERROR = "Unable to save the cell. Please try again.";
export const SELECTION_SAVE_ERROR = "Unable to save the selection. Please try again.";
export const TRANSFER_SAVE_ERROR = "Unable to transfer the range. Please try again.";

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback;
}

/**
 * Orchestrates cell editing for the active worksheet: the in-progress draft shared by the
 * grid and the "Formula bar", the atomic write of a committed cell, clipboard pastes and
 * the persisted selection rectangle. The workbook stays the single source of truth; a
 * rejected write leaves it untouched.
 */
export function useWorksheetEditing({
  workbook,
  worksheet,
  setWorkbook,
  onRecord,
}: WorksheetEditingOptions): WorksheetEditing {
  const [draft, setDraftState] = useState<CellDraft | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [clipboard, setClipboardState] = useState<RangeClipboard | null>(null);
  const draftRef = useRef<CellDraft | null>(null);
  const pendingRef = useRef(false);
  const clipboardRef = useRef<RangeClipboard | null>(null);
  const queuedSelectionRef = useRef<Selection | null>(null);

  function setDraft(next: CellDraft | null) {
    draftRef.current = next;
    setDraftState(next);
  }

  function setClipboard(next: RangeClipboard | null) {
    clipboardRef.current = next;
    setClipboardState(next);
  }

  const activeName = worksheet ? activeCellName(worksheet) : "A1";
  const storedText = worksheet
    ? worksheet.cells[activeName]?.formula ?? worksheet.cells[activeName]?.value ?? ""
    : "";
  const formulaBarValue = draft ? draft.input : storedText;
  const hasInternalRange = Boolean(clipboard && worksheet && clipboard.worksheetId === worksheet.id);

  // A different worksheet starts from its own stored content.
  useEffect(() => {
    draftRef.current = null;
    pendingRef.current = false;
    setDraftState(null);
    setPending(false);
    setError("");
  }, [worksheet?.id]);

  function recordResult(target: Workbook, before: ReturnType<typeof snapshotWorksheet>) {
    if (!onRecord || !worksheet) return;
    const result = target.worksheets.find((candidate) => candidate.id === worksheet.id);
    if (result) onRecord(worksheet.id, before, snapshotWorksheet(result));
  }

  function beginGridEdit(cell: string, input: string) {
    if (pendingRef.current) return;
    setError("");
    setDraft({ cell, input, source: "grid" });
  }

  function updateDraft(input: string) {
    if (pendingRef.current) return;
    const current = draftRef.current;
    setError("");
    setDraft(current ? { ...current, input } : { cell: activeName, input, source: "formula" });
  }

  function cancel() {
    setDraft(null);
    setError("");
  }

  async function commitDraft(selection?: Selection) {
    const current = draftRef.current;
    if (!current || pendingRef.current || !workbook || !worksheet) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    const before = snapshotWorksheet(worksheet);
    try {
      const updated = await writeWorksheetCells(workbook.id, worksheet.id, {
        updates: [{ name: current.cell, input: current.input }],
        ...(selection ? { selection } : {}),
      });
      setWorkbook(updated);
      recordResult(updated, before);
      // A selection asked for while the write was in flight is applied on top of the result.
      const queued = queuedSelectionRef.current;
      queuedSelectionRef.current = null;
      if (!selection && queued) {
        const stored = updated.worksheets.find((candidate) => candidate.id === worksheet.id)?.selection;
        applyServerSelection(queued, stored ?? queued);
      }
    } catch (cause) {
      // The whole write was rejected: the grid and formula bar keep the last saved content.
      queuedSelectionRef.current = null;
      setError(messageOf(cause, CELL_SAVE_ERROR));
    } finally {
      pendingRef.current = false;
      setPending(false);
      if (draftRef.current === current) setDraft(null);
    }
  }

  /** Committing is fire-and-forget for the event handlers; the hook reports failures itself. */
  function commit(selection?: Selection) {
    void commitDraft(selection);
  }

  function applyServerSelection(next: Selection, previous: Selection) {
    if (!workbook || !worksheet) return;
    if (sameSelection(previous, next)) return;
    setWorkbook((current) =>
      current
        ? {
            ...current,
            worksheets: current.worksheets.map((candidate) =>
              candidate.id === worksheet.id ? { ...candidate, selection: next } : candidate,
            ),
          }
        : current,
    );
    saveWorksheetSelection(workbook.id, worksheet.id, next).catch((cause) => {
      setWorkbook((current) =>
        current
          ? {
              ...current,
              worksheets: current.worksheets.map((candidate) =>
                candidate.id === worksheet.id ? { ...candidate, selection: previous } : candidate,
              ),
            }
          : current,
      );
      setError(messageOf(cause, SELECTION_SAVE_ERROR));
    });
  }

  function select(selection: Selection) {
    if (!workbook || !worksheet) return;
    if (pendingRef.current) {
      queuedSelectionRef.current = selection;
      return;
    }
    if (draftRef.current) {
      commit(selection);
      return;
    }
    applyServerSelection(selection, worksheet.selection);
  }

  /** Writes a single value without going through the inline editor (dropdown choices). */
  async function setValue(cell: string, input: string) {
    if (!workbook || !worksheet || pendingRef.current) return;
    setDraft(null);
    pendingRef.current = true;
    setPending(true);
    setError("");
    const before = snapshotWorksheet(worksheet);
    try {
      const updated = await writeWorksheetCells(workbook.id, worksheet.id, {
        updates: [{ name: cell, input }],
      });
      setWorkbook(updated);
      recordResult(updated, before);
    } catch (cause) {
      // The write was rejected: the cell keeps its previous value.
      setError(messageOf(cause, CELL_SAVE_ERROR));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function paste(startCell: string, text: string) {
    if (!workbook || !worksheet || pendingRef.current) return;
    const updates = clipboardUpdates(text, startCell);
    if (!updates || updates.length === 0) return;
    setDraft(null);
    pendingRef.current = true;
    setPending(true);
    setError("");
    const before = snapshotWorksheet(worksheet);
    try {
      const updated = await writeWorksheetCells(workbook.id, worksheet.id, { updates });
      setWorkbook(updated);
      recordResult(updated, before);
    } catch (cause) {
      // Nothing was pasted: every target cell keeps its previous value.
      setError(messageOf(cause, CELL_SAVE_ERROR));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function pasteFromClipboard(startCell: string) {
    if (!navigator.clipboard?.readText) {
      setError(CLIPBOARD_READ_ERROR);
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      await paste(startCell, text);
    } catch {
      setError(CLIPBOARD_READ_ERROR);
    }
  }

  function markRange(mode: "copy" | "cut") {
    if (!worksheet || pendingRef.current) return;
    setError("");
    setClipboard({
      worksheetId: worksheet.id,
      mode,
      source: { anchor: worksheet.selection.anchor, focus: worksheet.selection.focus },
    });
  }

  function copyRange() {
    markRange("copy");
  }

  function cutRange() {
    markRange("cut");
  }

  /** Pastes the internal copy/cut rectangle; the backend moves the whole range atomically. */
  async function pasteRangeInternal(startCell: string) {
    const clip = clipboardRef.current;
    if (!workbook || !worksheet || pendingRef.current) return;
    if (!clip || clip.worksheetId !== worksheet.id) return;
    setDraft(null);
    pendingRef.current = true;
    setPending(true);
    setError("");
    const before = snapshotWorksheet(worksheet);
    try {
      const updated = await transferWorksheetRange(workbook.id, worksheet.id, {
        mode: clip.mode,
        source: clip.source,
        target: { anchor: startCell, focus: startCell },
      });
      setWorkbook(updated);
      recordResult(updated, before);
      if (clip.mode === "cut") setClipboard(null);
    } catch (cause) {
      // The whole transfer was rejected: source and target keep their previous values.
      setError(messageOf(cause, TRANSFER_SAVE_ERROR));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return {
    draft,
    pending,
    error,
    formulaBarValue,
    clipboard,
    hasInternalRange,
    beginGridEdit,
    updateDraft,
    commit,
    cancel,
    select,
    setValue,
    paste,
    pasteFromClipboard,
    copyRange,
    cutRange,
    pasteRangeInternal,
  };
}

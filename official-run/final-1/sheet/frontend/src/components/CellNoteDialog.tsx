import { useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";

/** Shown when a save carries no note text; the server rejects the same payload. */
export const EMPTY_NOTE_MESSAGE = "Note text cannot be empty";

export interface CellNoteDialogProps {
  open: boolean;
  /** A1 coordinate of the cell the note belongs to; also part of the title. */
  coordinate: string;
  /** Text of the stored note, or `null` while the cell has no note yet. */
  note: string | null;
  onOpenChange(open: boolean): void;
  /** Persist the note text; a rejection keeps the dialog open with the message shown. */
  onSave(text: string): Promise<void>;
  /** Remove the note (and with it the cell's open button). */
  onDelete(): Promise<void>;
}

const NOTE_FIELD_ID = "cell-note-text";

/**
 * Note interface of one cell: a text box holding the note text, the "Save note"
 * command and, while a note is stored, "Edit note" and "Delete note". The
 * dialog is named after the cell, so the same form serves "Add note" on a cell
 * without a note and the note opened from its own cell: opening a note shows
 * its exact text in the box, which is also the text a save replaces. A rejected
 * save or delete keeps the form open with the last stored note still displayed.
 */
export function CellNoteDialog({
  open,
  coordinate,
  note,
  onOpenChange,
  onSave,
  onDelete,
}: CellNoteDialogProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const wasOpen = useRef(open);

  // The form starts from the note of the cell (empty while it has none) as the
  // dialog opens, so the first committed paint already shows the stored text.
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setDraft(note ?? "");
    setError(null);
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const run = async (action: () => Promise<void>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
      setBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (draft.trim() === "") {
      setError(EMPTY_NOTE_MESSAGE);
      return;
    }
    void run(() => onSave(draft), "Unable to save the note");
  };

  const remove = () => {
    void run(() => onDelete(), "Unable to delete the note");
  };

  return (
    <Dialog open={open} title={`Note for ${coordinate}`} onOpenChange={onOpenChange}>
      {/* The form carries no accessible name of its own: a container named
          after the note would shadow the "Note" field for label queries. */}
      <form className="cell-note" onSubmit={submit}>
        <FormField id={NOTE_FIELD_ID} label="Note">
          <textarea
            id={NOTE_FIELD_ID}
            ref={fieldRef}
            rows={3}
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
          />
        </FormField>
        {error ? (
          <p className="cell-note__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="cell-note__actions">
          {note !== null ? (
            <Button disabled={busy} onClick={() => fieldRef.current?.focus()}>
              Edit note
            </Button>
          ) : null}
          {note !== null ? (
            <Button variant="danger" disabled={busy} onClick={remove}>
              Delete note
            </Button>
          ) : null}
          <Button type="submit" variant="primary" disabled={busy}>
            Save note
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

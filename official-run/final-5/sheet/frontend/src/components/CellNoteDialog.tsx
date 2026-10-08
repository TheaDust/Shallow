import { useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";

export interface CellNoteDialogProps {
  open: boolean;
  /** A1 coordinate of the annotated cell, for example `D8`. */
  coordinate: string;
  /** Stored note text of that cell, or `null` when it has no note yet. */
  note: string | null;
  onOpenChange(open: boolean): void;
  /** Persist the note text; a rejection keeps the dialog open with its message. */
  onSave(text: string): Promise<void>;
  /** Remove the note of this cell. */
  onDelete(): Promise<void>;
}

const NOTE_FIELD_ID = "cell-note-text";

/**
 * Creates, edits or deletes the note of one cell. The dialog is named after the
 * cell it annotates, shows the stored text in its "Note" box, and writes
 * through the server, so a note survives a refresh while the cell value stays
 * untouched.
 *
 * The box is prefilled with the stored note, so opening a note displays its
 * exact text and "Edit note" selects that text for a one-action replacement;
 * "Delete note" removes the note together with its cell's open button. The
 * note text is rendered in one place only, so it is never ambiguous with the
 * cell's own value.
 */
export function CellNoteDialog({ open, coordinate, note, onOpenChange, onSave, onDelete }: CellNoteDialogProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  // Prefill the box from the stored note as the dialog opens, during render, so
  // the first committed paint already shows that note's exact text.
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
    void run(() => onSave(draft), "Unable to save the note");
  };

  return (
    <Dialog open={open} title={`Note for ${coordinate}`} onOpenChange={onOpenChange}>
      <form className="cell-note" onSubmit={submit}>
        <FormField id={NOTE_FIELD_ID} label="Note">
          <textarea
            id={NOTE_FIELD_ID}
            ref={fieldRef}
            className="cell-note__input"
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
          {note ? (
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                fieldRef.current?.focus();
                fieldRef.current?.select();
              }}
            >
              Edit note
            </Button>
          ) : null}
          {note ? (
            <Button type="button" variant="danger" disabled={busy} onClick={() => void run(() => onDelete(), "Unable to delete the note")}>
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

import { useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";

export interface NoteDialogProps {
  open: boolean;
  /** A1 coordinate of the cell the note belongs to, used in the dialog name. */
  coordinate: string;
  /** Text of the note already stored on that cell, or `undefined` when none. */
  note?: string;
  onOpenChange(open: boolean): void;
  /** Store the note text and repaint the cell's open button. */
  onSave(text: string): Promise<void>;
  /** Remove the note together with the cell's open button. */
  onDelete(): Promise<void>;
}

const NOTE_FIELD_ID = "cell-note-text";

/**
 * Shows, creates, edits and deletes the note of one cell. The dialog is named
 * `Note for <coordinate>` after the cell it was opened for. Its "Note" text box
 * always holds the current text (empty for a cell without a note), so the
 * dialog displays the note's exact text and "Save note" stores a new or
 * replaced text; a cell that already carries a note also offers "Edit note"
 * (which puts the caret into the text box) and "Delete note". A successful save
 * or delete closes the dialog so the repainted cell is right there; a rejected
 * action leaves the dialog open with its message.
 */
export function NoteDialog({ open, coordinate, note, onOpenChange, onSave, onDelete }: NoteDialogProps) {
  const [draft, setDraft] = useState(note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(open);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  // Each open starts from the note stored on the cell the dialog names.
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setDraft(note ?? "");
    setError(null);
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const run = (action: () => Promise<void>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    action()
      .then(() => {
        setBusy(false);
        onOpenChange(false);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : fallback);
        setBusy(false);
      });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (draft.trim() === "") {
      setError("Note text cannot be empty");
      return;
    }
    run(() => onSave(draft), "Unable to save the note");
  };

  const startEditing = () => {
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
  };

  return (
    <Dialog open={open} title={`Note for ${coordinate}`} onOpenChange={onOpenChange}>
      <div className="note-dialog">
        <form className="note-dialog__form" onSubmit={submit}>
          <FormField id={NOTE_FIELD_ID} label="Note" error={error ?? undefined}>
            <textarea
              id={NOTE_FIELD_ID}
              ref={fieldRef}
              className="note-dialog__text"
              rows={3}
              value={draft}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
            />
          </FormField>
          <div className="note-dialog__actions">
            <Button type="submit" variant="primary" disabled={busy}>
              Save note
            </Button>
            {note !== undefined ? (
              <Button disabled={busy} onClick={startEditing}>
                Edit note
              </Button>
            ) : null}
            {note !== undefined ? (
              <Button variant="danger" disabled={busy} onClick={() => run(() => onDelete(), "Unable to delete the note")}>
                Delete note
              </Button>
            ) : null}
          </div>
        </form>
      </div>
    </Dialog>
  );
}

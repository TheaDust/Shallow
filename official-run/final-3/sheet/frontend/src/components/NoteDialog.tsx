import { useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";

export interface NoteDialogProps {
  open: boolean;
  /** Coordinate of the annotated cell, for example `D8`. */
  coordinate: string;
  /**
   * Stored note of that cell, or `null` when the cell has no note yet. An
   * existing note is displayed with its exact text and can be edited in place
   * or deleted.
   */
  note: string | null;
  onOpenChange(open: boolean): void;
  /** Store the note text; the dialog closes when the save succeeds. */
  onSave(text: string): Promise<void>;
  /** Remove the note of the cell; the dialog closes when the delete succeeds. */
  onDelete(): Promise<void>;
}

const NOTE_FIELD_ID = "cell-note-text";

/**
 * Creates, edits and deletes the note of one cell. The dialog is named after
 * the cell it annotates (`Note for <cell coordinate>`) and its "Note" box holds
 * the exact note text. An existing note additionally offers "Edit note" and
 * "Delete note"; a note never changes the value shown in the cell.
 *
 * The dialog only exists while it is open, so a closed dialog leaves no node
 * behind and every opening starts from the currently stored note.
 */
export function NoteDialog(props: NoteDialogProps) {
  if (!props.open) return null;
  return <OpenNoteDialog {...props} />;
}

function OpenNoteDialog({ coordinate, note, onOpenChange, onSave, onDelete }: NoteDialogProps) {
  const [draft, setDraft] = useState(note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
    void run(() => onSave(draft), "Unable to save the note");
  };

  return (
    <Dialog open title={`Note for ${coordinate}`} onOpenChange={onOpenChange}>
      <div className="note-dialog">
        <form className="note-dialog__form" onSubmit={submit}>
          <FormField id={NOTE_FIELD_ID} label="Note">
            <textarea
              id={NOTE_FIELD_ID}
              ref={inputRef}
              rows={4}
              value={draft}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
            />
          </FormField>
          {error ? (
            <p className="note-dialog__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="note-dialog__actions">
            <Button type="submit" variant="primary" disabled={busy}>
              Save note
            </Button>
            {note !== null ? (
              <Button type="button" disabled={busy} onClick={() => inputRef.current?.focus()}>
                Edit note
              </Button>
            ) : null}
            {note !== null ? (
              <Button
                type="button"
                variant="danger"
                disabled={busy}
                onClick={() => void run(() => onDelete(), "Unable to delete the note")}
              >
                Delete note
              </Button>
            ) : null}
          </div>
        </form>
      </div>
    </Dialog>
  );
}

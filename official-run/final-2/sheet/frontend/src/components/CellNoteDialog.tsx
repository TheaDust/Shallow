import { useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField, fieldDescriptionIds } from "../ui/FormField";
import { EMPTY_NOTE_MESSAGE } from "../domain/types";

export interface CellNoteDialogProps {
  open: boolean;
  /** A1 coordinate of the cell whose note the dialog shows. */
  coordinate: string;
  /** Stored text of that cell's note, or `null` when the cell has none. */
  note: string | null;
  onOpenChange(open: boolean): void;
  /** Stores `text` as the cell's note; a rejection keeps the dialog open. */
  onSave(text: string): Promise<void>;
  /** Removes the cell's note; the grid loses its open button. */
  onDelete(): Promise<void>;
}

const NOTE_FIELD_ID = "cell-note-text";

/**
 * Note of one cell, opened from the "Insert" menu's "Add note" or from the
 * "Open note for <coordinate>" button of a noted cell. The dialog is named
 * "Note for <coordinate>", carries the text box "Note" and the "Save note"
 * button, and shows an existing note's exact text together with its
 * "Edit note" and "Delete note" buttons. Saving replaces the stored text and
 * closes the dialog so the grid shows the note's open button; deleting removes
 * the note with its button. A rejected save reports its message in the dialog
 * and leaves the stored note and the cell value as they were.
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
  const fieldRef = useRef<HTMLInputElement>(null);
  const wasOpen = useRef(false);

  // Every opening starts from the stored note: the field describes the note of
  // the cell the dialog names, never the text of a previous opening.
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setDraft(note ?? "");
    setError(null);
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const stored = typeof note === "string" && note !== "" ? note : null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (draft.trim() === "") {
      setError(EMPTY_NOTE_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(draft);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the note");
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete();
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete the note");
      setBusy(false);
    }
  };

  /** Puts the caret into the note text with its text selected for replacement. */
  const startEditing = () => {
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    field.select();
  };
  return (
    <Dialog open={open} title={`Note for ${coordinate}`} onOpenChange={onOpenChange}>
      {open ? (
        <div className="cell-note">
          {stored ? <p className="cell-note__text">{stored}</p> : null}
          <form className="cell-note__form" onSubmit={submit}>
            <FormField id={NOTE_FIELD_ID} label="Note" error={error ?? undefined}>
              <input
                id={NOTE_FIELD_ID}
                className="cell-note__input"
                type="text"
                value={draft}
                ref={fieldRef}
                disabled={busy}
                aria-describedby={fieldDescriptionIds(NOTE_FIELD_ID, { error: Boolean(error) })}
                onChange={(event) => setDraft(event.target.value)}
              />
            </FormField>
            <div className="cell-note__actions">
              <Button type="submit" variant="primary" disabled={busy}>
                Save note
              </Button>
              {stored ? (
                <>
                  <Button disabled={busy} onClick={startEditing}>
                    Edit note
                  </Button>
                  <Button variant="danger" disabled={busy} onClick={() => void remove()}>
                    Delete note
                  </Button>
                </>
              ) : null}
            </div>
          </form>
        </div>
      ) : null}
    </Dialog>
  );
}

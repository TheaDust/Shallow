import { useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField, fieldDescriptionIds } from "../ui/FormField";
import {
  INVALID_NAMED_RANGE_MESSAGE,
  NAMED_RANGE_NAME_MESSAGE,
  isValidNamedRangeName,
} from "../domain/named-ranges";
import type { NamedRange } from "../domain/types";

export interface NamedRangesDialogProps {
  open: boolean;
  /** Saved names of the workbook, in save order. */
  ranges: NamedRange[];
  onOpenChange(open: boolean): void;
  /** Creates or replaces one name; a rejection keeps the dialog open. */
  onSave(name: string, range: string): Promise<void>;
}

const NAME_FIELD_ID = "named-range-name";
const RANGE_FIELD_ID = "named-range-range";

/**
 * Lists the workbook's named ranges and adds or edits one. "Add named range"
 * opens the fields labeled "Name" and "Range"; "Edit <name>" opens the same
 * fields prefilled with the saved range. A name must start with a letter, so a
 * rejected save shows the message inside the dialog and stores nothing, while a
 * successful save closes the dialog (the grid behind it shows the recalculated
 * formulas) and the new name stays listed when it is reopened.
 */
export function NamedRangesDialog({ open, ranges, onOpenChange, onSave }: NamedRangesDialogProps) {
  const [formOpen, setFormOpen] = useState(false);
  /** Name of the range being edited, or `null` while adding a new one. */
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [range, setRange] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(open);

  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setFormOpen(false);
    setEditing(null);
    setName("");
    setRange("");
    setError(null);
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const addNew = () => {
    setFormOpen(true);
    setEditing(null);
    setName("");
    setRange("");
    setError(null);
  };

  const edit = (entry: NamedRange) => {
    setFormOpen(true);
    setEditing(entry.name);
    setName(entry.name);
    setRange(entry.range);
    setError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const trimmedName = name.trim();
    const trimmedRange = range.trim();
    if (!isValidNamedRangeName(trimmedName)) {
      setError(NAMED_RANGE_NAME_MESSAGE);
      return;
    }
    if (trimmedRange === "") {
      setError(INVALID_NAMED_RANGE_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(trimmedName, trimmedRange);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the named range");
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title="Named ranges" onOpenChange={onOpenChange}>
      <div className="named-ranges">
        {ranges.length === 0 ? (
          <p className="named-ranges__empty">No named ranges yet</p>
        ) : (
          <ul className="named-ranges__list">
            {ranges.map((entry) => (
              <li key={entry.name} className="named-ranges__item">
                <span className="named-ranges__name">{entry.name}</span>
                <span className="named-ranges__range">{entry.range}</span>
                <Button disabled={busy} onClick={() => edit(entry)}>
                  Edit {entry.name}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="named-ranges__actions">
          <Button disabled={busy} onClick={addNew}>
            Add named range
          </Button>
        </div>
        {formOpen ? (
          <form className="named-ranges__form" onSubmit={submit}>
            <FormField id={NAME_FIELD_ID} label="Name">
              <input
                id={NAME_FIELD_ID}
                type="text"
                value={name}
                readOnly={editing !== null}
                disabled={busy}
                aria-describedby={fieldDescriptionIds(NAME_FIELD_ID, { error: Boolean(error) })}
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
            <FormField id={RANGE_FIELD_ID} label="Range">
              <input
                id={RANGE_FIELD_ID}
                type="text"
                value={range}
                disabled={busy}
                aria-describedby={fieldDescriptionIds(RANGE_FIELD_ID, { error: Boolean(error) })}
                onChange={(event) => setRange(event.target.value)}
              />
            </FormField>
            <div className="named-ranges__actions">
              <Button type="submit" variant="primary" disabled={busy}>
                Save
              </Button>
            </div>
          </form>
        ) : null}
        {error ? (
          <p className="named-ranges__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

import { useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import {
  INVALID_NAMED_RANGE_MESSAGE,
  NAMED_RANGE_NAME_MESSAGE,
  namedRangeNameValid,
  namedRangeStartsWithLetter,
  parseNamedRangeReference,
} from "../domain/named-ranges";
import type { NamedRange } from "../domain/types";

const NAME_FIELD_ID = "named-range-name";
const RANGE_FIELD_ID = "named-range-range";

export interface NamedRangesDialogProps {
  open: boolean;
  /** Names already saved on the workbook, in the order they were created. */
  namedRanges: NamedRange[];
  onOpenChange(open: boolean): void;
  /** Persist the name; a rejection keeps the dialog open with its message. */
  onSave(name: string, range: string): Promise<void>;
}

/**
 * Lists the workbook's named ranges and, through "Add named range" or one of
 * the "Edit <name>" controls, collects a "Name" and a "Range" for the server to
 * store. Saving closes the dialog so the grid is operable again; a rejected
 * save (for example a name that does not start with a letter) keeps it open and
 * shows the exact message.
 */
export function NamedRangesDialog({ open, namedRanges, onOpenChange, onSave }: NamedRangesDialogProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [range, setRange] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(open);

  // Reset the form as the dialog opens, during render, so the first committed
  // paint already shows the list without a stale draft or message.
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setFormOpen(false);
    setName("");
    setRange("");
    setError(null);
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const startAdd = () => {
    setFormOpen(true);
    setName("");
    setRange("");
    setError(null);
  };

  const startEdit = (entry: NamedRange) => {
    setFormOpen(true);
    setName(entry.name);
    setRange(entry.range);
    setError(null);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!namedRangeStartsWithLetter(name)) {
      setError(NAMED_RANGE_NAME_MESSAGE);
      return;
    }
    if (!namedRangeNameValid(name)) {
      setError("Invalid named range name");
      return;
    }
    if (!parseNamedRangeReference(range)) {
      setError(INVALID_NAMED_RANGE_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    onSave(name.trim(), range.trim())
      .then(() => onOpenChange(false))
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Unable to save the named range");
        setBusy(false);
      });
  };

  return (
    <Dialog open={open} title="Named ranges" onOpenChange={onOpenChange}>
      <div className="named-ranges">
        {namedRanges.length > 0 ? (
          <ul className="named-ranges__list" aria-label="Named ranges">
            {namedRanges.map((entry) => (
              <li key={entry.name} className="named-ranges__item">
                <span className="named-ranges__name">{entry.name}</span>
                <Button disabled={busy} onClick={() => startEdit(entry)}>
                  {`Edit ${entry.name}`}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {formOpen ? (
          <form className="named-ranges__form" onSubmit={submit}>
            <FormField id={NAME_FIELD_ID} label="Name">
              <input
                id={NAME_FIELD_ID}
                type="text"
                value={name}
                disabled={busy}
                aria-invalid={error ? true : undefined}
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
            <FormField id={RANGE_FIELD_ID} label="Range">
              <input
                id={RANGE_FIELD_ID}
                type="text"
                value={range}
                disabled={busy}
                onChange={(event) => setRange(event.target.value)}
              />
            </FormField>
            {error ? (
              <p className="named-ranges__error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="named-ranges__actions">
              <Button type="submit" variant="primary" disabled={busy}>
                Save
              </Button>
            </div>
          </form>
        ) : (
          <Button onClick={startAdd}>Add named range</Button>
        )}
      </div>
    </Dialog>
  );
}

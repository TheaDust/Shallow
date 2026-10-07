import { useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField, fieldDescriptionIds } from "../ui/FormField";
import type { NamedRange } from "../domain/types";

export interface NamedRangesDialogProps {
  open: boolean;
  /** Names stored in the workbook, in stored order. */
  namedRanges: NamedRange[];
  onOpenChange(open: boolean): void;
  /**
   * Store one name (a new one when `id` is absent, otherwise the stored range
   * with that id). The server validates the name, so a rejection keeps the form
   * open with its message and stores nothing.
   */
  onSave(entry: { id?: string; name: string; range: string }): Promise<void>;
}

const NAME_FIELD_ID = "named-range-name";
const RANGE_FIELD_ID = "named-range-range";

/**
 * Management interface of the workbook's named ranges. "Add named range" and
 * "Edit <name>" both fill the same Name/Range form; a successful save closes the
 * dialog, so the grid is usable again with the name already stored, while a
 * rejected name (for example one that does not start with a letter) stays in the
 * form with its message.
 */
export function NamedRangesDialog({ open, namedRanges, onOpenChange, onSave }: NamedRangesDialogProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [range, setRange] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** A form is shown only after "Add named range" or "Edit <name>" was clicked. */
  const [formVisible, setFormVisible] = useState(false);
  const wasOpen = useRef(open);

  // Every open starts from the list, so a draft of the previous visit is gone.
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setEditingId(null);
    setName("");
    setRange("");
    setError(null);
    setBusy(false);
    setFormVisible(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const startAdd = () => {
    setEditingId(null);
    setName("");
    setRange("");
    setError(null);
    setFormVisible(true);
  };

  const startEdit = (entry: NamedRange) => {
    setEditingId(entry.id);
    setName(entry.name);
    setRange(entry.range);
    setError(null);
    setFormVisible(true);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    onSave({ ...(editingId ? { id: editingId } : {}), name, range })
      .then(() => {
        setBusy(false);
        onOpenChange(false);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Unable to save the named range");
        setBusy(false);
      });
  };

  return (
    <Dialog open={open} title="Named ranges" onOpenChange={onOpenChange}>
      <div className="named-ranges">
        <ul className="named-ranges__list" aria-label="Named ranges">
          {namedRanges.map((entry) => (
            <li key={entry.id} className="named-ranges__item">
              <span className="named-ranges__name">{entry.name}</span>
              <span className="named-ranges__target">{entry.range}</span>
              <Button disabled={busy} onClick={() => startEdit(entry)}>{`Edit ${entry.name}`}</Button>
            </li>
          ))}
        </ul>
        {namedRanges.length === 0 && !formVisible ? <p className="named-ranges__empty">No named ranges.</p> : null}
        {formVisible ? (
          <form className="named-ranges__form" onSubmit={submit}>
            <FormField id={NAME_FIELD_ID} label="Name">
              <input
                id={NAME_FIELD_ID}
                type="text"
                value={name}
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
          <div className="named-ranges__actions">
            <Button variant="primary" disabled={busy} onClick={startAdd}>
              Add named range
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

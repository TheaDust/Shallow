import { useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField, fieldDescriptionIds } from "../ui/FormField";
import { EMPTY_FILTER_VIEW_NAME_MESSAGE } from "../domain/filter";

export interface SaveFilterViewDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Stores the view under the trimmed name; a rejection keeps the dialog open. */
  onSave(name: string): Promise<void>;
}

const NAME_FIELD_ID = "filter-view-name";

/**
 * Names the currently applied filter so it can be chosen again later. The name
 * is trimmed, must be nonempty and unique within the workbook; a rejected save
 * (for example a duplicate) shows its message inside the dialog and keeps the
 * interface open with the typed name and the stored views unchanged.
 */
export function SaveFilterViewDialog({ open, onOpenChange, onSave }: SaveFilterViewDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(open);

  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setName("");
    setError(null);
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError(EMPTY_FILTER_VIEW_NAME_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(trimmed);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the filter view");
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title="Save filter view" onOpenChange={onOpenChange}>
      <form className="save-filter-view" aria-label="Save filter view" onSubmit={submit}>
        <FormField id={NAME_FIELD_ID} label="Filter view name">
          <input
            id={NAME_FIELD_ID}
            type="text"
            value={name}
            disabled={busy}
            aria-describedby={fieldDescriptionIds(NAME_FIELD_ID, { error: Boolean(error) })}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        {error ? (
          <p className="save-filter-view__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="save-filter-view__actions">
          <Button type="submit" variant="primary" disabled={busy}>
            Save view
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

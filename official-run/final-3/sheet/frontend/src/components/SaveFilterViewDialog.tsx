import { useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField, fieldDescriptionIds } from "../ui/FormField";

export interface SaveFilterViewDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Persist the currently applied filter under the trimmed name. */
  onSave(name: string): Promise<void>;
}

const NAME_FIELD_ID = "filter-view-name";

/** Message shown when the name is blank after trimming. */
export const EMPTY_FILTER_VIEW_NAME_MESSAGE = "Filter view name cannot be empty";

/**
 * Names the currently applied filter so it can be reused later. The name is
 * trimmed before it is sent; a rejected save (for example a duplicate name the
 * server reports) keeps the interface open with its message, and a successful
 * save closes it.
 */
export function SaveFilterViewDialog({ open, onOpenChange, onSave }: SaveFilterViewDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(open);

  // A freshly opened interface starts empty, during render, so the first paint
  // never shows the previous attempt's name or message.
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setName("");
    setError(null);
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (trimmed === "") {
      setError(EMPTY_FILTER_VIEW_NAME_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    onSave(trimmed)
      .then(() => onOpenChange(false))
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Unable to save the filter view");
        setBusy(false);
      });
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

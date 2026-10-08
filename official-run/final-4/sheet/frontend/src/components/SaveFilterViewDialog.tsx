import { useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField, fieldDescriptionIds } from "../ui/FormField";

export interface SaveFilterViewDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /**
   * Persist the applied filter under `name`. A rejected name (empty, already
   * used) reports its message and keeps the dialog open.
   */
  onSave(name: string): Promise<void>;
}

const NAME_FIELD_ID = "filter-view-name";

/**
 * Saves the filter currently applied to the active worksheet as a named filter
 * view. The name is trimmed before it is sent; the server checks emptiness and
 * workbook-wide uniqueness, so a duplicate name shows its message here and the
 * dialog stays open with the typed text.
 */
export function SaveFilterViewDialog({ open, onOpenChange, onSave }: SaveFilterViewDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(open);

  // Each open starts a fresh draft, so a rejected name is not carried over.
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
    setBusy(true);
    setError(null);
    onSave(trimmed)
      .then(() => {
        setBusy(false);
        onOpenChange(false);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Unable to save the filter view");
        setBusy(false);
      });
  };

  return (
    <Dialog open={open} title="Save filter view" onOpenChange={onOpenChange}>
      <form className="save-filter-view" onSubmit={submit}>
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

import { useEffect, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField, fieldDescriptionIds } from "../ui/FormField";

export interface SaveFilterViewDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Store the currently applied filter under `name`; a rejection keeps the dialog open. */
  onSave(name: string): Promise<void>;
}

const NAME_FIELD_ID = "save-filter-view-name";

/**
 * Saves the filter currently applied to the active worksheet under a name. The
 * server trims the name and requires it to be unique inside the workbook, so a
 * duplicate is reported with its own message while the dialog stays open with
 * the typed name, ready for a different one.
 */
export function SaveFilterViewDialog({ open, onOpenChange, onSave }: SaveFilterViewDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setError(null);
      setSaving(false);
    }
  }, [open]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    if (name.trim() === "") {
      setError("Please enter a filter view name");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(name);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the filter view");
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} title="Save filter view" onOpenChange={onOpenChange}>
      <form className="save-filter-view" aria-label="Save filter view" onSubmit={submit}>
        <FormField id={NAME_FIELD_ID} label="Filter view name" error={error ?? undefined}>
          <input
            id={NAME_FIELD_ID}
            type="text"
            value={name}
            disabled={saving}
            aria-invalid={error ? true : undefined}
            aria-describedby={fieldDescriptionIds(NAME_FIELD_ID, { error: Boolean(error) })}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <div className="save-filter-view__actions">
          <Button type="submit" variant="primary" disabled={saving}>
            Save view
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

import { useRef, useState, type FormEvent } from "react";

import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { FormField, fieldDescriptionIds } from "../ui/FormField";
import { EMPTY_WORKSHEET_NAME_MESSAGE } from "../domain/types";

export interface RenameWorksheetDialogProps {
  open: boolean;
  /** Last saved worksheet name, used to prefill the text box. */
  currentName: string;
  onOpenChange(open: boolean): void;
  onSave(name: string): Promise<void>;
}

const NAME_FIELD_ID = "rename-worksheet-name";

/**
 * Renames the current worksheet. A save rejected by the server (longer than 50
 * characters, a case-insensitive duplicate or a failed request) keeps the tab
 * and the prefilled value: the error is shown and the text box falls back to
 * the last successful name, so the tab, the menu label and a reopened dialog
 * all agree with the stored worksheet. A whitespace-only name is rejected in
 * the dialog itself with "Worksheet name cannot be empty".
 */
export function RenameWorksheetDialog({ open, currentName, onOpenChange, onSave }: RenameWorksheetDialogProps) {
  const [value, setValue] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const wasOpen = useRef(open);

  // Reset the form to the current worksheet name as the dialog opens, during
  // render, so the text box is prefilled in the first committed paint instead
  // of showing an empty value until a later effect runs.
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setValue(currentName);
    setError(null);
    setSaving(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    // Leading/trailing spaces are trimmed before the emptiness check, so a
    // whitespace-only name reports "Worksheet name cannot be empty".
    const trimmed = value.trim();
    if (!trimmed) {
      setError(EMPTY_WORKSHEET_NAME_MESSAGE);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
      onOpenChange(false);
    } catch (caught) {
      setValue(currentName);
      setError(caught instanceof Error ? caught.message : "Unable to rename worksheet");
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} title="Rename worksheet" onOpenChange={onOpenChange}>
      <form className="rename-worksheet" aria-label="Rename worksheet" onSubmit={submit}>
        <FormField id={NAME_FIELD_ID} label="Worksheet name" error={error ?? undefined}>
          <input
            id={NAME_FIELD_ID}
            type="text"
            value={value}
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={fieldDescriptionIds(NAME_FIELD_ID, { error: Boolean(error) })}
            onChange={(event) => setValue(event.target.value)}
          />
        </FormField>
        <div className="rename-worksheet__actions">
          <Button type="submit" variant="primary" disabled={saving}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

import { useRef, useState, type FormEvent } from "react";

import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { FormField, fieldDescriptionIds } from "../ui/FormField";
import {
  EMPTY_WORKSHEET_NAME_MESSAGE,
  LONG_WORKSHEET_NAME_MESSAGE,
  MAX_WORKSHEET_NAME_LENGTH,
} from "../domain/types";

export interface RenameWorksheetDialogProps {
  open: boolean;
  /** Last saved worksheet name, used to prefill the text box. */
  currentName: string;
  onOpenChange(open: boolean): void;
  onSave(name: string): Promise<void>;
}

const NAME_FIELD_ID = "rename-worksheet-name";

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

  /**
   * Reports a rejected save and restores the last saved name, so the tab and
   * this prefilled field keep showing that name. The server re-checks every
   * rule (including the case-insensitive uniqueness inside the workbook).
   */
  const reject = (message: string) => {
    setValue(currentName);
    setError(message);
    setSaving(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    // Leading/trailing spaces are trimmed before the checks, so a
    // whitespace-only name reports "Worksheet name cannot be empty" and the
    // length limit counts the trimmed name.
    const trimmed = value.trim();
    if (!trimmed) {
      reject(EMPTY_WORKSHEET_NAME_MESSAGE);
      return;
    }
    if (trimmed.length > MAX_WORKSHEET_NAME_LENGTH) {
      reject(LONG_WORKSHEET_NAME_MESSAGE);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
      onOpenChange(false);
    } catch (caught) {
      reject(caught instanceof Error ? caught.message : "Unable to rename worksheet");
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

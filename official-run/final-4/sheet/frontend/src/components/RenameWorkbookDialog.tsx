import { useEffect, useState, type FormEvent } from "react";

import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { FormField, fieldDescriptionIds } from "../ui/FormField";
import {
  EMPTY_WORKBOOK_NAME_MESSAGE,
  LONG_WORKBOOK_NAME_MESSAGE,
  WORKBOOK_NAME_MAX_LENGTH,
} from "../domain/types";

export interface RenameWorkbookDialogProps {
  open: boolean;
  /** Last saved workbook name, used to prefill the text box. */
  currentName: string;
  onOpenChange(open: boolean): void;
  onSave(name: string): Promise<void>;
}

/**
 * Message of a rejected name, or `null` when it may be sent to the server. The
 * server re-checks every rule (it owns the names of all workbooks); the local
 * length rule only gives the same answer without a round trip.
 */
function rejectionFor(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return EMPTY_WORKBOOK_NAME_MESSAGE;
  if (trimmed.length > WORKBOOK_NAME_MAX_LENGTH) return LONG_WORKBOOK_NAME_MESSAGE;
  return null;
}

const NAME_FIELD_ID = "rename-workbook-name";

export function RenameWorkbookDialog({ open, currentName, onOpenChange, onSave }: RenameWorkbookDialogProps) {
  const [value, setValue] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(currentName);
      setError(null);
      setSaving(false);
    }
  }, [open, currentName]);

  /**
   * A rejected name never changes the stored workbook: the field falls back to
   * the last saved name (the value the dialog prefills with) while the exact
   * rejection message stays visible, so the editor title and the home-page link
   * keep showing the last successful name too.
   */
  const reject = (message: string) => {
    setValue(currentName);
    setError(message);
    setSaving(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const rejection = rejectionFor(value);
    if (rejection) {
      reject(rejection);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(value.trim());
      onOpenChange(false);
    } catch (caught) {
      reject(caught instanceof Error ? caught.message : "Unable to save workbook name");
    }
  };

  return (
    <Dialog open={open} title="Rename workbook" onOpenChange={onOpenChange}>
      <form className="rename-workbook" aria-label="Rename workbook" onSubmit={submit}>
        <FormField id={NAME_FIELD_ID} label="Workbook name" error={error ?? undefined}>
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
        <div className="rename-workbook__actions">
          <Button type="submit" variant="primary" disabled={saving}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

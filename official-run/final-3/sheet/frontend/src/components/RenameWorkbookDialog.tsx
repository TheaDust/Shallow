import { useEffect, useState, type FormEvent } from "react";

import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { FormField, fieldDescriptionIds } from "../ui/FormField";
import { EMPTY_WORKBOOK_NAME_MESSAGE } from "../domain/types";

export interface RenameWorkbookDialogProps {
  open: boolean;
  /** Last saved workbook name, used to prefill the text box. */
  currentName: string;
  onOpenChange(open: boolean): void;
  onSave(name: string): Promise<void>;
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

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const trimmed = value.trim();
    if (!trimmed) {
      setError(EMPTY_WORKBOOK_NAME_MESSAGE);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
      onOpenChange(false);
    } catch (caught) {
      // A rejected save keeps the last successful name in the text box, so the
      // field never displays a name the workbook does not have.
      setError(caught instanceof Error ? caught.message : "Unable to save workbook name");
      setValue(currentName);
      setSaving(false);
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

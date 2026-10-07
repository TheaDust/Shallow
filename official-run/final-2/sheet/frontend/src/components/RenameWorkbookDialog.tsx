import { useEffect, useState, type FormEvent } from "react";

import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { FormField, fieldDescriptionIds } from "../ui/FormField";
import { EMPTY_WORKBOOK_NAME_MESSAGE, LONG_WORKBOOK_NAME_MESSAGE, MAX_WORKBOOK_NAME_LENGTH } from "../domain/types";

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

  /**
   * Reports a rejected save and restores the last saved name, so the editor
   * title, the home-page link and this field keep showing that name. The
   * server re-checks every rule (including cross-workbook uniqueness).
   */
  const reject = (message: string) => {
    setValue(currentName);
    setError(message);
    setSaving(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const trimmed = value.trim();
    if (!trimmed) {
      reject(EMPTY_WORKBOOK_NAME_MESSAGE);
      return;
    }
    if (trimmed.length > MAX_WORKBOOK_NAME_LENGTH) {
      reject(LONG_WORKBOOK_NAME_MESSAGE);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
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

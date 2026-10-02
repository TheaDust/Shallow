import { useEffect, useState, type FormEvent } from "react";

import { Button, Dialog, FormField } from "../ui";

export const EMPTY_NAME_MESSAGE = "Workbook name cannot be empty";

export interface RenameWorkbookDialogProps {
  open: boolean;
  currentName: string;
  busy: boolean;
  error: string | null;
  onClose(): void;
  onSave(name: string): Promise<boolean>;
}

export function RenameWorkbookDialog({ open, currentName, busy, error, onClose, onSave }: RenameWorkbookDialogProps) {
  const [name, setName] = useState(currentName);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(currentName);
      setLocalError(null);
    }
  }, [open, currentName]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setLocalError(EMPTY_NAME_MESSAGE);
      return;
    }
    setLocalError(null);
    const success = await onSave(trimmed);
    if (success) onClose();
  };

  const visibleError = open ? localError ?? error : null;

  return (
    <Dialog
      open={open}
      title="Rename workbook"
      description="Enter a new name for this workbook."
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <form className="rename-workbook-form" onSubmit={submit}>
        <FormField id="rename-workbook-name" label="Workbook name" error={visibleError ?? undefined}>
          <input
            id="rename-workbook-name"
            name="workbookName"
            type="text"
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <div className="ui-dialog__actions">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>Save</Button>
        </div>
      </form>
    </Dialog>
  );
}

import { useState, type FormEvent } from "react";

import { Dialog } from "../../ui/Dialog";
import { Button } from "../../ui/Button";
import { FormField } from "../../ui/FormField";
import { errorMessage } from "../../lib/workbooks-api";

export interface RenameWorkbookDialogProps {
  open: boolean;
  currentName: string;
  onClose(): void;
  onSave(name: string): Promise<unknown>;
}

export function RenameWorkbookDialog({ open, currentName, onClose, onSave }: RenameWorkbookDialogProps) {
  if (!open) return null;
  return <RenameWorkbookForm currentName={currentName} onClose={onClose} onSave={onSave} />;
}

function RenameWorkbookForm({ currentName, onClose, onSave }: Omit<RenameWorkbookDialogProps, "open">) {
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("Workbook name cannot be empty");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(trimmed);
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  };

  return (
    <Dialog open title="Rename workbook" onOpenChange={(next) => { if (!next) onClose(); }}>
      <form className="rename-workbook-form" onSubmit={submit}>
        <FormField id="rename-workbook-name" label="Workbook name" error={error ?? undefined}>
          <input
            id="rename-workbook-name"
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <div className="form-actions">
          <Button type="submit" variant="primary" disabled={busy}>Save</Button>
        </div>
      </form>
    </Dialog>
  );
}

import { useState, type FormEvent } from "react";

import { Dialog } from "../../ui/Dialog";
import { Button } from "../../ui/Button";
import { FormField } from "../../ui/FormField";
import { errorMessage } from "../../lib/workbooks-api";

export const WORKSHEET_NAME_REQUIRED = "Worksheet name cannot be empty";
export const WORKSHEET_NAME_DUPLICATE = "Worksheet name already exists";

export interface RenameWorksheetDialogProps {
  open: boolean;
  currentName: string;
  /** Names of the other worksheets of the same workbook, used for the duplicate check. */
  otherNames: readonly string[];
  onClose(): void;
  onSave(name: string): Promise<unknown>;
}

export function RenameWorksheetDialog({
  open,
  currentName,
  otherNames,
  onClose,
  onSave,
}: RenameWorksheetDialogProps) {
  if (!open) return null;
  return (
    <RenameWorksheetForm
      currentName={currentName}
      otherNames={otherNames}
      onClose={onClose}
      onSave={onSave}
    />
  );
}

function RenameWorksheetForm({
  currentName,
  otherNames,
  onClose,
  onSave,
}: Omit<RenameWorksheetDialogProps, "open">) {
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError(WORKSHEET_NAME_REQUIRED);
      return;
    }
    if (otherNames.includes(trimmed)) {
      setError(WORKSHEET_NAME_DUPLICATE);
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
    <Dialog
      open
      title="Rename worksheet"
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <form className="rename-worksheet-form" onSubmit={submit}>
        <FormField id="rename-worksheet-name" label="Worksheet name" error={error ?? undefined}>
          <input
            id="rename-worksheet-name"
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <div className="form-actions">
          <Button type="submit" variant="primary" disabled={busy}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

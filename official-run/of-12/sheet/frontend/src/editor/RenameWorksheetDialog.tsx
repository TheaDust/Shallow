import { useEffect, useState, type FormEvent } from "react";

import { Button, Dialog, FormField } from "../ui";

export const EMPTY_WORKSHEET_NAME_MESSAGE = "Worksheet name cannot be empty";

export interface RenameWorksheetDialogProps {
  open: boolean;
  /** Name of the worksheet being renamed: the text box starts prefilled with it. */
  currentName: string;
  busy: boolean;
  /** Rejection reported by the server (`Worksheet name already exists`, a write failure, …). */
  error: string | null;
  onClose(): void;
  onSave(name: string): Promise<boolean>;
}

/**
 * `Rename` dialog of one worksheet tab (REQ-2-1-3): a text box labeled `Worksheet name` prefilled
 * with the current name and a `Save` button. An empty name is rejected in place; a duplicate name
 * comes back from the server as its message. Either way the dialog stays open, shows the error
 * beside the text box, and the tab keeps the previous name.
 */
export function RenameWorksheetDialog({
  open,
  currentName,
  busy,
  error,
  onClose,
  onSave,
}: RenameWorksheetDialogProps) {
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
      setLocalError(EMPTY_WORKSHEET_NAME_MESSAGE);
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
      title="Rename worksheet"
      description="Enter a new name for this worksheet."
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <form className="rename-worksheet-form" onSubmit={submit}>
        <FormField id="rename-worksheet-name" label="Worksheet name" error={visibleError ?? undefined}>
          <input
            id="rename-worksheet-name"
            name="worksheetName"
            type="text"
            value={name}
            disabled={busy}
            onChange={(event) => {
              setName(event.target.value);
              setLocalError(null);
            }}
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

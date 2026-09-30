import { useEffect, useId, useState, type FormEvent } from "react";

import { Button, Dialog, FormField } from "../ui";
import { renameWorkbook, requestErrorMessage, type WorkbookPayload } from "./api";

export const EMPTY_WORKBOOK_NAME_MESSAGE = "Workbook name cannot be empty";

export interface RenameWorkbookDialogProps {
  workbookId: string;
  open: boolean;
  /** Last saved workbook name; the text box is prefilled with it every time the dialog opens. */
  currentName: string;
  onOpenChange(open: boolean): void;
  onSaved(saved: WorkbookPayload): void;
}

export function RenameWorkbookDialog({
  workbookId,
  open,
  currentName,
  onOpenChange,
  onSaved,
}: RenameWorkbookDialogProps) {
  const inputId = useId();
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(currentName);
    setError(null);
    setBusy(false);
  }, [open, currentName, workbookId]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (trimmed === "") {
      setError(EMPTY_WORKBOOK_NAME_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await renameWorkbook(workbookId, trimmed);
      onSaved(saved);
      onOpenChange(false);
    } catch (caught) {
      // The failure is reported in the dialog and the editor keeps showing the last saved name.
      setError(requestErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title="Rename workbook" onOpenChange={onOpenChange}>
      <form className="rename-form" onSubmit={(event) => void save(event)}>
        <FormField
          id={inputId}
          label="Workbook name"
          error={error ?? undefined}
          description="Leading and trailing spaces are removed. The name cannot be empty."
        >
          <input
            id={inputId}
            type="text"
            value={name}
            disabled={busy}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
        </FormField>
        <div className="rename-form__actions">
          <Button type="submit" variant="primary" disabled={busy}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

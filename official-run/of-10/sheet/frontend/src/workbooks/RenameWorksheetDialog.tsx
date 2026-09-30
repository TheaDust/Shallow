import { useEffect, useId, useState, type FormEvent } from "react";

import { Button, Dialog, FormField } from "../ui";
import { renameWorksheet, requestErrorMessage, type WorkbookPayload } from "./api";

export const EMPTY_WORKSHEET_NAME_MESSAGE = "Worksheet name cannot be empty";

export interface RenameWorksheetDialogProps {
  workbookId: string;
  worksheetId: string;
  open: boolean;
  /** Last saved name of the worksheet; the text box is prefilled with it every time it opens. */
  currentName: string;
  onOpenChange(open: boolean): void;
  onSaved(saved: WorkbookPayload): void;
}

/**
 * The `Rename worksheet` dialog of one worksheet tab menu: the trimmed name must be non-empty and
 * unused in the workbook. A failure is reported inside the dialog and the stored name stays.
 */
export function RenameWorksheetDialog({
  workbookId,
  worksheetId,
  open,
  currentName,
  onOpenChange,
  onSaved,
}: RenameWorksheetDialogProps) {
  const inputId = useId();
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(currentName);
    setError(null);
    setBusy(false);
  }, [open, currentName, worksheetId, workbookId]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (trimmed === "") {
      setError(EMPTY_WORKSHEET_NAME_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await renameWorksheet(workbookId, worksheetId, trimmed);
      onSaved(saved);
      onOpenChange(false);
    } catch (caught) {
      setError(requestErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title="Rename worksheet" onOpenChange={onOpenChange}>
      <form className="rename-form" onSubmit={(event) => void save(event)}>
        <FormField
          id={inputId}
          label="Worksheet name"
          error={error ?? undefined}
          description="Leading and trailing spaces are removed. The name must be unique in this workbook."
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

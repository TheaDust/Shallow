import { useState, type FormEvent } from "react";

import { Button, Dialog, FormField, fieldDescriptionIds } from "../../ui";
import { errorMessage, renameWorksheet } from "./api";
import type { WorkbookData, WorksheetData } from "./types";

export const RENAME_WORKSHEET_FIELD_ID = "rename-worksheet-name";
export const EMPTY_WORKSHEET_NAME_MESSAGE = "Worksheet name cannot be empty";
export const WORKSHEET_NAME_EXISTS_MESSAGE = "Worksheet name already exists";

export interface RenameWorksheetDialogProps {
  workbook: WorkbookData;
  worksheet: WorksheetData;
  onRenamed(workbook: WorkbookData): void;
  onCancel(): void;
}

/**
 * Modal "Rename worksheet" dialog opened from the worksheet tab menu. It is
 * mounted only while a worksheet is being renamed, so the text box always
 * starts from that worksheet's current name.
 */
export function RenameWorksheetDialog({ workbook, worksheet, onRenamed, onCancel }: RenameWorksheetDialogProps) {
  const [name, setName] = useState(worksheet.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (trimmed === "") {
      setError(EMPTY_WORKSHEET_NAME_MESSAGE);
      return;
    }
    if (workbook.worksheets.some((sheet) => sheet.id !== worksheet.id && sheet.name === trimmed)) {
      setError(WORKSHEET_NAME_EXISTS_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { workbook: saved } = await renameWorksheet(workbook.id, worksheet.id, name);
      onRenamed(saved);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title="Rename worksheet"
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <form className="rename-worksheet" onSubmit={(event) => void submit(event)}>
        <FormField id={RENAME_WORKSHEET_FIELD_ID} label="Worksheet name" error={error ?? undefined}>
          <input
            id={RENAME_WORKSHEET_FIELD_ID}
            type="text"
            value={name}
            aria-invalid={error ? true : undefined}
            aria-describedby={fieldDescriptionIds(RENAME_WORKSHEET_FIELD_ID, { error: Boolean(error) })}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
        </FormField>
        <div className="form-actions">
          <Button type="submit" variant="primary" disabled={busy}>
            Save
          </Button>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

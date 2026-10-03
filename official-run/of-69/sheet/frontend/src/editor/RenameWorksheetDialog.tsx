import { useState } from "react";

import { ApiError } from "../lib/api";
import { renameWorksheet } from "../domain/workbook-api";
import type { Workbook, Worksheet } from "../domain/types";
import { Button, Dialog, FormField } from "../ui";

export const WORKSHEET_NAME_EMPTY_MESSAGE = "Worksheet name cannot be empty";

export interface RenameWorksheetDialogProps {
  workbookId: string;
  worksheet: Worksheet;
  onOpenChange(open: boolean): void;
  onRenamed(workbook: Workbook): void;
}

/**
 * Rename dialog for one worksheet, mounted per target so the text box is prefilled with the
 * current name on open. Validation failures keep the dialog open and the tab name unchanged.
 */
export function RenameWorksheetDialog({ workbookId, worksheet, onOpenChange, onRenamed }: RenameWorksheetDialogProps) {
  const [name, setName] = useState(worksheet.name);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError(WORKSHEET_NAME_EMPTY_MESSAGE);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const updated = await renameWorksheet(workbookId, worksheet.id, trimmed);
      onRenamed(updated);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to save the worksheet name. Please try again.");
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      title="Rename worksheet"
      onOpenChange={onOpenChange}
      actions={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            Save
          </Button>
        </>
      }
    >
      <FormField id="rename-worksheet-name" label="Worksheet name" error={error || undefined}>
        <input
          id="rename-worksheet-name"
          type="text"
          value={name}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            setName(event.target.value);
            if (error) setError("");
          }}
        />
      </FormField>
    </Dialog>
  );
}

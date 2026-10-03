import { useEffect, useState } from "react";

import { ApiError } from "../lib/api";
import { renameWorkbook } from "../domain/workbook-api";
import type { Workbook } from "../domain/types";
import { Button, Dialog, FormField } from "../ui";

export const WORKBOOK_NAME_EMPTY_MESSAGE = "Workbook name cannot be empty";

export interface RenameWorkbookDialogProps {
  open: boolean;
  workbook: Workbook;
  onOpenChange(open: boolean): void;
  onRenamed(workbook: Workbook): void;
}

export function RenameWorkbookDialog({ open, workbook, onOpenChange, onRenamed }: RenameWorkbookDialogProps) {
  const [name, setName] = useState(workbook.name);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(workbook.name);
      setError("");
      setSaving(false);
    }
  }, [open, workbook.name]);

  async function save() {
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError(WORKBOOK_NAME_EMPTY_MESSAGE);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const updated = await renameWorkbook(workbook.id, trimmed);
      onRenamed(updated);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to save the workbook name. Please try again.");
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      title="Rename workbook"
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
      <FormField id="rename-workbook-name" label="Workbook name" error={error || undefined}>
        <input
          id="rename-workbook-name"
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

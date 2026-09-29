import { useEffect, useId, useState } from "react";

import type { Workbook } from "../domain/types";
import { renameWorkbook } from "../lib/api";
import { Button, Dialog, FormField } from "../ui";

export interface RenameWorkbookDialogProps {
  open: boolean;
  workbookId: string;
  initialName: string;
  onOpenChange(open: boolean): void;
  onSaved(workbook: Workbook): void;
}

export function RenameWorkbookDialog({ open, workbookId, initialName, onOpenChange, onSaved }: RenameWorkbookDialogProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldId = useId();

  useEffect(() => {
    if (open) {
      setName(initialName);
      setError(null);
      setBusy(false);
    }
  }, [open, initialName]);

  const save = async () => {
    const trimmed = name.trim();
    if (trimmed === "") {
      setError("Workbook name cannot be empty");
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const workbook = await renameWorkbook(workbookId, trimmed);
      onSaved(workbook);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to rename workbook");
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Rename workbook"
      onOpenChange={onOpenChange}
      actions={
        <Button variant="primary" disabled={busy} onClick={() => void save()}>
          Save
        </Button>
      }
    >
      <FormField id={fieldId} label="Workbook name" error={error ?? undefined}>
        <input
          id={fieldId}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
          }}
        />
      </FormField>
    </Dialog>
  );
}

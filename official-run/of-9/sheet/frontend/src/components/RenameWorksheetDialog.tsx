import { useEffect, useId, useState } from "react";

import type { Workbook, Worksheet } from "../domain/types";
import { renameSheet } from "../lib/api";
import { Button, Dialog, FormField } from "../ui";

export interface RenameWorksheetDialogProps {
  open: boolean;
  workbookId: string;
  sheet: Worksheet | null;
  onOpenChange(open: boolean): void;
  onSaved(workbook: Workbook): void;
}

export function RenameWorksheetDialog({
  open,
  workbookId,
  sheet,
  onOpenChange,
  onSaved,
}: RenameWorksheetDialogProps) {
  const [name, setName] = useState(sheet?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldId = useId();

  useEffect(() => {
    if (open && sheet) {
      setName(sheet.name);
      setError(null);
      setBusy(false);
    }
  }, [open, sheet]);

  const save = async () => {
    if (!sheet) return;
    const trimmed = name.trim();
    if (trimmed === "") {
      setError("Worksheet name cannot be empty");
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const workbook = await renameSheet(workbookId, sheet.id, trimmed);
      onSaved(workbook);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to rename worksheet");
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Rename worksheet"
      onOpenChange={onOpenChange}
      actions={
        <Button variant="primary" disabled={busy} onClick={() => void save()}>
          Save
        </Button>
      }
    >
      <FormField id={fieldId} label="Worksheet name" error={error ?? undefined}>
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

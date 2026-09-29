import { useEffect, useState } from "react";

import { Button, Dialog, FormField, fieldDescriptionIds } from "../../ui";
import { errorMessage, importWorkbookCsv } from "./api";
import { readFileText } from "./format";
import type { WorkbookData } from "./types";

export const CSV_FILE_FIELD_ID = "import-csv-file";

export interface ImportCsvDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onImported(workbook: WorkbookData): void;
}

export function ImportCsvDialog({ open, onOpenChange, onImported }: ImportCsvDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) return;
    setFile(null);
    setError(null);
    setBusy(false);
  }, [open]);

  const confirm = async () => {
    if (busy) return;
    if (!file) {
      setError("Select a CSV file to import.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const content = await readFileText(file);
      const { workbook } = await importWorkbookCsv(file.name, content);
      onImported(workbook);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Import CSV"
      description="The imported rows and columns keep their original order; the first row stays ordinary data."
      onOpenChange={onOpenChange}
      actions={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void confirm()} disabled={busy}>
            Confirm import
          </Button>
        </>
      }
    >
      <FormField id={CSV_FILE_FIELD_ID} label="CSV file" error={error ?? undefined}>
        <input
          id={CSV_FILE_FIELD_ID}
          type="file"
          accept=".csv,text/csv"
          aria-invalid={error ? true : undefined}
          aria-describedby={fieldDescriptionIds(CSV_FILE_FIELD_ID, { error: Boolean(error) })}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setError(null);
          }}
        />
      </FormField>
    </Dialog>
  );
}

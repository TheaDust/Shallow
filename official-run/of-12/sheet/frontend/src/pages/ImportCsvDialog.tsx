import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

import { errorMessage } from "../hooks/useWorkbook";
import { importCsvWorkbook, type Workbook } from "../lib/workbooks";
import { Button, Dialog, FormField } from "../ui";

export interface ImportCsvDialogProps {
  open: boolean;
  onClose(): void;
  onImported(workbook: Workbook): void;
}

export const NO_FILE_MESSAGE = "Select a CSV file to import.";

async function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("The selected file could not be read."));
    reader.readAsText(file);
  });
}

export function ImportCsvDialog({ open, onClose, onImported }: ImportCsvDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setError(null);
    setBusy(false);
    setInputKey((value) => value + 1);
  }, [open]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!file) {
      setError(NO_FILE_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const content = await readFileText(file);
      onImported(await importCsvWorkbook(file.name, content));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Import CSV"
      description="Choose a CSV file to import as a new workbook."
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <form className="import-csv-form" onSubmit={submit} noValidate>
        <FormField id="import-csv-file" label="CSV file" error={error ?? undefined}>
          <input
            key={inputKey}
            id="import-csv-file"
            name="csvFile"
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setFile(event.target.files?.[0] ?? null);
              setError(null);
            }}
          />
        </FormField>
        <div className="ui-dialog__actions">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>Confirm import</Button>
        </div>
      </form>
    </Dialog>
  );
}

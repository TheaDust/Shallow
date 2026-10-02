import { useState, type ChangeEvent, type FormEvent } from "react";

import type { Workbook } from "../domain/workbook";
import { readFileAsText } from "../lib/csv-transfer";
import { importWorkbookCsv } from "../lib/workbook-api";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";

const FILE_FIELD_ID = "csv-import-file";
const FALLBACK_ERROR = "Invalid CSV file format. Import failed.";

export interface ImportCsvDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onImported(workbook: Workbook): void;
}

/**
 * "Import CSV" dialog: pick a CSV file, then "Confirm import" creates a new
 * workbook named after the file and opens its Sheet1. Parse failures are shown
 * next to the file control and never create a workbook.
 */
export function ImportCsvDialog({ open, onOpenChange, onImported }: ImportCsvDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function changeOpen(next: boolean) {
    if (!next && busy) return;
    if (!next) {
      setFile(null);
      setError(null);
    }
    onOpenChange(next);
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !file) return;
    setBusy(true);
    setError(null);
    try {
      const content = await readFileAsText(file);
      const workbook = await importWorkbookCsv(file.name, content);
      setBusy(false);
      setFile(null);
      onImported(workbook);
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : FALLBACK_ERROR);
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title="Import CSV" closeLabel="Close import dialog" onOpenChange={changeOpen}>
      <form className="csv-import" onSubmit={submit} noValidate>
        <FormField id={FILE_FIELD_ID} label="CSV file" error={error ?? undefined}>
          <input
            id={FILE_FIELD_ID}
            name="csv-file"
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={chooseFile}
          />
        </FormField>
        {busy ? <p role="status" className="csv-import__status">Importing…</p> : null}
        <div className="csv-import__actions">
          <Button type="submit" variant="primary" disabled={busy || file === null}>Confirm import</Button>
        </div>
      </form>
    </Dialog>
  );
}

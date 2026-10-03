import { useState, type ChangeEvent, type FormEvent } from "react";

import { Dialog } from "../../ui/Dialog";
import { Button } from "../../ui/Button";
import { FormField } from "../../ui/FormField";
import { errorMessage, importWorkbookCsv } from "../../lib/workbooks-api";
import { readFileText } from "../../lib/file-text";
import type { Workbook } from "../../domain/types";

export interface ImportCsvDialogProps {
  open: boolean;
  onClose(): void;
  onImported(workbook: Workbook): void;
}

/**
 * "Import CSV" dialog on the workbook home page. The chosen file is read as
 * UTF-8 text and sent to the server, which parses it and creates the workbook
 * only when the whole file is valid CSV.
 */
export function ImportCsvDialog({ open, onClose, onImported }: ImportCsvDialogProps) {
  if (!open) return null;
  return <ImportCsvForm onClose={onClose} onImported={onImported} />;
}

function ImportCsvForm({ onClose, onImported }: Omit<ImportCsvDialogProps, "open">) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setFile(event.target.files?.[0] ?? null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!file) {
      setError("Choose a CSV file to import.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const content = await readFileText(file);
      const workbook = await importWorkbookCsv(file.name, content);
      onImported(workbook);
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  };

  return (
    <Dialog open title="Import CSV" onOpenChange={(next) => { if (!next) onClose(); }}>
      <form className="import-csv-form" onSubmit={submit}>
        <FormField id="import-csv-file" label="CSV file" error={error ?? undefined}>
          <input
            id="import-csv-file"
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={handleFileChange}
          />
        </FormField>
        {busy ? <p role="status">Importing…</p> : null}
        <div className="form-actions">
          <Button type="submit" variant="primary" disabled={busy}>Confirm import</Button>
        </div>
      </form>
    </Dialog>
  );
}

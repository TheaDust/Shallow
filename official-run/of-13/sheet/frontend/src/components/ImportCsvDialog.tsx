import { useState } from "react";

import { importWorkbookFromCsv } from "../api/workbooks";
import { readFileText } from "../lib/file-io";
import { navigate } from "../lib/hash-route";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";

export interface ImportCsvDialogProps {
  onClose(): void;
}

/** Create-workbook dialog for the CSV import workflow; a failed import leaves no record. */
export function ImportCsvDialog({ onClose }: ImportCsvDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function submit() {
    if (importing) return;
    if (!file) {
      setError("Select a CSV file to import.");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const content = await readFileText(file);
      const { workbook } = await importWorkbookFromCsv(file.name, content);
      navigate(`/workbooks/${workbook.id}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Invalid CSV file format. Import failed.");
      setImporting(false);
    }
  }

  return (
    <Dialog
      open
      title="Import CSV"
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      actions={
        <>
          <Button onClick={onClose} disabled={importing}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={importing}>
            Confirm import
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <FormField id="import-csv-file" label="CSV file" error={error ?? undefined}>
          <input
            id="import-csv-file"
            name="csv-file"
            type="file"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setError(null);
            }}
          />
        </FormField>
      </form>
      {importing ? <p role="status">Importing CSV file…</p> : null}
    </Dialog>
  );
}

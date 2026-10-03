import { useEffect, useRef, useState } from "react";

import { ApiError } from "../lib/api";
import { readFileAsText } from "../lib/read-file-text";
import { importCsvWorkbook } from "../domain/workbook-api";
import type { Workbook } from "../domain/types";
import { Button, Dialog, FormField } from "../ui";

export const CSV_REQUIRED_MESSAGE = "Choose a CSV file to import.";
export const CSV_IMPORT_FAILED_MESSAGE = "Unable to import the CSV file. Please try again.";

export interface ImportCsvDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onImported(workbook: Workbook): void;
}

export function ImportCsvDialog({ open, onOpenChange, onImported }: ImportCsvDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setError("");
    setImporting(false);
    if (inputRef.current) inputRef.current.value = "";
  }, [open]);

  async function confirmImport() {
    if (importing) return;
    if (!file) {
      setError(CSV_REQUIRED_MESSAGE);
      return;
    }
    setImporting(true);
    setError("");
    try {
      const content = await readFileAsText(file);
      const workbook = await importCsvWorkbook(file.name, content);
      onImported(workbook);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : CSV_IMPORT_FAILED_MESSAGE);
      setImporting(false);
    }
  }

  return (
    <Dialog
      open={open}
      title="Import CSV"
      onOpenChange={onOpenChange}
      actions={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={importing}>
            Cancel
          </Button>
          <Button variant="primary" onClick={confirmImport} disabled={importing}>
            Confirm import
          </Button>
        </>
      }
    >
      <FormField id="import-csv-file" label="CSV file" error={error || undefined}>
        <input
          id="import-csv-file"
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            if (error) setError("");
          }}
        />
      </FormField>
      {importing ? <p role="status">Importing CSV…</p> : null}
    </Dialog>
  );
}

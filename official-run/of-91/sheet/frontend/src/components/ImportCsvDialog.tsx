import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import { INVALID_CSV_MESSAGE, parseCsv } from "../domain/csv";
import { importWorkbook } from "../lib/workbook-api";
import type { Workbook } from "../domain/types";

const FILE_FIELD_ID = "import-csv-file";

export interface ImportCsvDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onImported(workbook: Workbook): void;
}

async function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file"));
    reader.readAsText(file, "utf-8");
  });
}

export function ImportCsvDialog({ open, onOpenChange, onImported }: ImportCsvDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null);
    setError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    if (!file) {
      setError("Choose a CSV file to import.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const text = await readFileText(file);
      const rows = parseCsv(text);
      const workbook = await importWorkbook(file.name, rows);
      onImported(workbook);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : INVALID_CSV_MESSAGE);
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} title="Import CSV" onOpenChange={onOpenChange}>
      <form className="import-csv" onSubmit={submit}>
        <FormField id={FILE_FIELD_ID} label="CSV file" error={error ?? undefined}>
          <input id={FILE_FIELD_ID} type="file" accept=".csv,text/csv" onChange={chooseFile} />
        </FormField>
        <div className="dialog-actions">
          <Button type="submit" variant="primary" disabled={submitting}>
            Confirm import
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

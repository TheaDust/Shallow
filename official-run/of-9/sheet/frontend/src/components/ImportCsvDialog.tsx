import { useId, useState } from "react";

import { ApiError, importWorkbook } from "../lib/api";
import { navigate } from "../lib/hash-route";
import { Button, Dialog, FormField } from "../ui";

export interface ImportCsvDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function ImportCsvDialog({ open, onOpenChange }: ImportCsvDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileId = useId();

  const readFileText = (selected: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Could not read the selected file"));
      reader.readAsText(selected, "utf-8");
    });

  const confirm = async () => {
    if (!file) {
      setError("CSV file is required.");
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const text = await readFileText(file);
      const workbook = await importWorkbook(file.name, text);
      onOpenChange(false);
      navigate(`/workbook/${encodeURIComponent(workbook.id)}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Import failed.");
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Import CSV"
      onOpenChange={onOpenChange}
      actions={
        <Button variant="primary" disabled={busy} onClick={() => void confirm()}>
          Confirm import
        </Button>
      }
    >
      <FormField id={fileId} label="CSV file" error={error ?? undefined}>
        <input
          id={fileId}
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setError(null);
          }}
        />
      </FormField>
    </Dialog>
  );
}

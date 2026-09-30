import { useEffect, useId, useRef, useState } from "react";

import { navigate } from "../lib/hash-route";
import { Button, Dialog, FormField } from "../ui";
import { importCsvWorkbook, requestErrorMessage } from "./api";
import { readFileText } from "./file";

export interface ImportCsvDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function ImportCsvDialog({ open, onOpenChange }: ImportCsvDialogProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) return;
    setFileName(null);
    setError(null);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }, [open]);

  const confirmImport = async () => {
    if (busy) return;
    const file = inputRef.current?.files?.[0] ?? null;
    if (!file) {
      setError("Please choose a CSV file to import.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { workbook } = await importCsvWorkbook(file.name, await readFileText(file));
      onOpenChange(false);
      navigate(`/workbooks/${workbook.id}`);
    } catch (caught) {
      setError(requestErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Import CSV"
      onOpenChange={onOpenChange}
      actions={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => void confirmImport()} disabled={busy}>
            Confirm import
          </Button>
        </>
      }
    >
      <FormField
        id={inputId}
        label="CSV file"
        error={error ?? undefined}
        description={fileName ? `Selected file: ${fileName}` : "Choose a .csv file to import as a new workbook."}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            setFileName(event.target.files?.[0]?.name ?? null);
            setError(null);
          }}
        />
      </FormField>
    </Dialog>
  );
}

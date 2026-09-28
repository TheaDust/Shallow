import { useRef, useState } from "react";

import { Dialog } from "./Dialog";
import { errorMessage, importCsv } from "../lib/workbooks";

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsText(file, "utf-8");
  });
}

interface ImportDialogProps {
  onImported: (workbookId: string) => void;
  onClose: () => void;
}

export function ImportDialog({ onImported, onClose }: ImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Select a CSV file to import");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const content = await readFileText(file);
      const workbook = await importCsv(file.name, content);
      onImported(workbook.id);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog label="Import CSV" onClose={onClose}>
      <h2 id="import-csv-title">Import CSV</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleConfirm();
        }}
      >
        <div className="form-field">
          <label htmlFor="csv-file">CSV file</label>
          <input
            id="csv-file"
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            disabled={busy}
          />
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Importing…" : "Confirm import"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

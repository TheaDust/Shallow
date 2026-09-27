import { useState } from "react";
import { importCsv } from "../api";
import { INVALID_CSV_MESSAGE } from "../csv";

export interface ImportCsvDialogProps {
  onClose: () => void;
  onImported: (workbookId: string) => void;
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Failed to read the CSV file"));
    reader.readAsText(file, "utf-8");
  });
}

export default function ImportCsvDialog({ onClose, onImported }: ImportCsvDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirmImport() {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const text = await readFileText(file);
      const { workbook } = await importCsv(file.name, text);
      onImported(workbook.id);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : INVALID_CSV_MESSAGE);
      setBusy(false);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Import CSV" className="dialog">
        <h2>Import CSV</h2>
        <div className="field">
          <label htmlFor="import-csv-file">CSV file</label>
          <input
            id="import-csv-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setFileName(f?.name ?? null);
            }}
          />
          {fileName && <span className="file-name">{fileName}</span>}
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" disabled={!file || busy} onClick={confirmImport}>
            Confirm import
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { importCsv } from '../api';
import type { Workbook } from '../types';

interface ImportCsvDialogProps {
  onImported: (workbook: Workbook) => void;
  onClose: () => void;
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsText(file, 'UTF-8');
  });
}

export default function ImportCsvDialog({ onImported, onClose }: ImportCsvDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) {
      return;
    }
    if (typeof el.showModal === 'function') {
      try {
        el.showModal();
        return;
      } catch {
        // fall back to the open attribute where showModal is unavailable
      }
    }
    el.setAttribute('open', '');
  }, []);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setError(null);
  }

  async function handleConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }
    if (!file) {
      setError('Please select a CSV file.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const text = await readFileText(file);
      const workbook = await importCsv(file.name, text);
      onImported(workbook);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Import CSV"
      className="import-dialog"
      onClose={onClose}
    >
      <h2>Import CSV</h2>
      <form className="import-form" onSubmit={handleConfirm}>
        <label htmlFor="import-csv-file">CSV file</label>
        <input
          id="import-csv-file"
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="import-actions">
          <button type="button" className="import-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="import-confirm" disabled={submitting}>
            Confirm import
          </button>
        </div>
      </form>
    </dialog>
  );
}

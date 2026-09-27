import { useState } from "react";
import { ApiError } from "../api";

export interface RenameDialogProps {
  currentName: string;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}

export default function RenameDialog({ currentName, onSave, onClose }: RenameDialogProps) {
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(name);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "Failed to save the workbook name");
      }
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div role="dialog" aria-modal="true" aria-label="Rename workbook" className="dialog">
        <h2>Rename workbook</h2>
        <div className="field">
          <label htmlFor="rename-workbook-name">Workbook name</label>
          <input
            id="rename-workbook-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={submit}>
            Save
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

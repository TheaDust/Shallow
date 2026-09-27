import { useState } from "react";
import { ApiError } from "../api";

export interface RenameSheetDialogProps {
  currentName: string;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}

export default function RenameSheetDialog({ currentName, onSave, onClose }: RenameSheetDialogProps) {
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
        setError(err instanceof Error ? err.message : "Failed to save the worksheet name");
      }
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
      <div role="dialog" aria-modal="true" aria-label="Rename worksheet" className="dialog">
        <h2>Rename worksheet</h2>
        <div className="field">
          <label htmlFor="rename-sheet-name">Worksheet name</label>
          <input
            id="rename-sheet-name"
            type="text"
            value={name}
            autoFocus
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

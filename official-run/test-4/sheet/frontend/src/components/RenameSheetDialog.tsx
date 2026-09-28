import { useState } from "react";

import { Dialog } from "./Dialog";
import { errorMessage } from "../lib/workbooks";

interface RenameSheetDialogProps {
  currentName: string;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}

export function RenameSheetDialog({ currentName, onSave, onClose }: RenameSheetDialogProps) {
  const [draft, setDraft] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    const trimmed = draft.trim();
    if (trimmed === "") {
      setError("Worksheet name cannot be empty");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(trimmed);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog label="Rename worksheet" onClose={onClose}>
      <h2>Rename worksheet</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleSave();
        }}
      >
        <div className="form-field">
          <label htmlFor="rename-sheet-name">Worksheet name</label>
          <input
            id="rename-sheet-name"
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
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
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

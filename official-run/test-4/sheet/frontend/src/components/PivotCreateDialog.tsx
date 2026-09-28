import { useState } from "react";

import { Dialog } from "./Dialog";
import type { CellRange } from "../lib/spreadsheet";

interface PivotCreateDialogProps {
  /** The selected source range, shown as "Source range: <cell range>". */
  range: CellRange;
  onCreate: () => Promise<void>;
  onClose: () => void;
}

/**
 * The "Create pivot table" dialog (REQ-5-3-1): shows the selected source
 * range, offers the "New worksheet" radio option, and its "Create" button
 * creates a PivotN result worksheet (Pivot1 first) that becomes active.
 */
export function PivotCreateDialog({ range, onCreate, onClose }: PivotCreateDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate();
      onClose();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog label="Create pivot table" onClose={onClose}>
      <h2>Create pivot table</h2>
      <p className="source-range-text">
        Source range: {range.start}:{range.end}
      </p>

      <div className="dialog-field">
        <label className="dialog-checkbox-row">
          <input type="radio" name="pivot-location" checked readOnly aria-label="New worksheet" />
          New worksheet
        </label>
      </div>

      {error && (
        <p role="alert" className="dialog-error">
          {error}
        </p>
      )}

      <div className="dialog-actions">
        <button type="button" className="primary" onClick={() => void create()} disabled={busy}>
          Create
        </button>
        <button type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

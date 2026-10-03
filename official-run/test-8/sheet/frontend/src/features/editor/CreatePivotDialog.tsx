import { useState } from "react";

import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { rangeLabel } from "../../domain/pivot";
import { errorMessage } from "../../lib/workbooks-api";
import type { CellRange } from "../../domain/types";

export interface CreatePivotDialogProps {
  /** Source rectangle the pivot reads (its first row holds the headers). */
  range: CellRange;
  onClose(): void;
  onCreate(): Promise<unknown>;
}

/**
 * "Create pivot table" dialog: shows the source range the current selection
 * covers, offers the "New worksheet" destination radio and creates the pivot
 * result worksheet. A rejection keeps the dialog open with the message.
 */
export function CreatePivotDialog({ range, onClose, onCreate }: CreatePivotDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate();
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title="Create pivot table"
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <div className="create-pivot-dialog">
        <p className="create-pivot-dialog__source">Source range: {rangeLabel(range)}</p>
        <label className="create-pivot-dialog__option">
          <input
            type="radio"
            name="pivot-destination"
            value="new"
            checked
            onChange={() => undefined}
          />
          New worksheet
        </label>
        {error ? <p className="ui-field__error" role="alert">{error}</p> : null}
        <div className="form-actions">
          <Button variant="primary" onClick={() => void create()} disabled={busy}>Create</Button>
        </div>
      </div>
    </Dialog>
  );
}

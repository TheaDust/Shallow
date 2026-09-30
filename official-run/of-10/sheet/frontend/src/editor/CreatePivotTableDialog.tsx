import { useEffect, useState } from "react";

import { regionToRef, type CellRegion } from "../lib/cells";
import { Button, Dialog } from "../ui";
import { requestErrorMessage } from "../workbooks/api";

export interface CreatePivotTableDialogProps {
  open: boolean;
  /** Range the pivot table will read: the selection with its header row. */
  sourceRange: CellRegion;
  onOpenChange(open: boolean): void;
  /** Creates the pivot result worksheet; a rejection keeps the dialog open with its message. */
  onCreate(): Promise<void>;
}

/**
 * `Create pivot table` dialog of the `Data` menu: it names the source range the summary reads and
 * creates the `PivotN` result worksheet, which then opens in the `Pivot table editor` region.
 */
export function CreatePivotTableDialog({ open, sourceRange, onOpenChange, onCreate }: CreatePivotTableDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSubmitting(false);
  }, [open]);

  const create = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await onCreate();
    } catch (createError) {
      setError(requestErrorMessage(createError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Create pivot table"
      onOpenChange={onOpenChange}
      actions={
        <Button variant="primary" onClick={() => void create()} disabled={submitting}>
          Create
        </Button>
      }
    >
      <p className="pivot-dialog__source">Source range: {regionToRef(sourceRange)}</p>
      <div className="pivot-dialog__destination">
        <label className="pivot-dialog__radio">
          <input type="radio" name="pivot-destination" value="new" checked readOnly />
          New worksheet
        </label>
      </div>
      {error ? (
        <p className="pivot-dialog__error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

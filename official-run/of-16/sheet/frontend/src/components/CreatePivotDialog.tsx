import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

export interface CreatePivotDialogProps {
  /** A1 text of the selected source range, shown as `Source range: <cell range>`. */
  sourceRange: string;
  busy?: boolean;
  error?: string | null;
  onCreate(): void;
  onOpenChange(open: boolean): void;
}

/**
 * "Create pivot table" dialog (REQ-5-3-1).
 *
 * It names the source range the pivot will read and offers the `New worksheet`
 * radio destination plus the `Create` button; creating makes the first unused
 * `PivotN` worksheet the active pivot-result worksheet. A failure keeps the
 * dialog open with its error and creates nothing.
 */
export function CreatePivotDialog({
  sourceRange,
  busy = false,
  error = null,
  onCreate,
  onOpenChange,
}: CreatePivotDialogProps) {
  return (
    <Dialog
      open
      title="Create pivot table"
      closeLabel="Close Create pivot table dialog"
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
      actions={<Button variant="primary" disabled={busy} onClick={onCreate}>Create</Button>}
    >
      <div className="create-pivot">
        <p className="create-pivot__source">Source range: {sourceRange}</p>
        <fieldset className="create-pivot__destination">
          <legend>Destination</legend>
          <label>
            <input type="radio" name="pivot-destination" value="new-worksheet" checked readOnly />
            New worksheet
          </label>
        </fieldset>
        {error ? <p role="alert" className="create-pivot__error">{error}</p> : null}
      </div>
    </Dialog>
  );
}

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

export interface CreatePivotTableDialogProps {
  /** Canonical `A1:C4` text of the selected source range. */
  range: string;
  busy?: boolean;
  error?: string;
  onCreate(): void;
  onClose(): void;
}

/**
 * `Create pivot table` dialog (REQ-5-3-1): it shows the source range the pivot will read, lets
 * the user pick the target (`New worksheet`) and creates the pivot-result worksheet. The
 * summary itself is configured afterwards in the `Pivot table editor` region of that worksheet.
 */
export function CreatePivotTableDialog({
  range,
  busy = false,
  error = "",
  onCreate,
  onClose,
}: CreatePivotTableDialogProps) {
  return (
    <Dialog
      open
      title="Create pivot table"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      actions={
        <Button variant="primary" disabled={busy} onClick={onCreate}>
          Create
        </Button>
      }
    >
      <p className="pivot-dialog__range">Source range: {range}</p>
      <fieldset className="pivot-dialog__target">
        <label>
          <input type="radio" name="pivot-target" value="new-worksheet" checked readOnly disabled={busy} />
          New worksheet
        </label>
      </fieldset>
      {error ? (
        <p role="alert" className="page-error">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

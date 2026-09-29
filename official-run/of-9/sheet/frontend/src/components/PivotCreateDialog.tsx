import { Button, Dialog } from "../ui";

export interface PivotCreateDialogProps {
  open: boolean;
  sourceRange: string;
  busy?: boolean;
  onOpenChange(open: boolean): void;
  onCreate(): void;
}

/**
 * The "Create pivot table" dialog. It shows the current selection as the
 * source range, offers the "New worksheet" radio destination and creates the
 * pivot-result worksheet when "Create" is clicked.
 */
export function PivotCreateDialog({ open, sourceRange, busy, onOpenChange, onCreate }: PivotCreateDialogProps) {
  return (
    <Dialog open={open} title="Create pivot table" onOpenChange={onOpenChange}>
      <p className="pivot-create-dialog__source">Source range: {sourceRange}</p>
      <fieldset className="pivot-create-dialog__destination">
        <legend>Destination</legend>
        <label className="pivot-create-dialog__option">
          <input type="radio" name="pivot-destination" value="new-worksheet" defaultChecked />
          New worksheet
        </label>
      </fieldset>
      <div className="pivot-create-dialog__actions">
        <Button variant="primary" disabled={busy} onClick={onCreate}>
          Create
        </Button>
      </div>
    </Dialog>
  );
}

import type { CellRange } from "../lib/spreadsheet";
import { rangeLabel } from "../lib/spreadsheet";
import { Button, Dialog } from "../ui";

export interface CreatePivotTableDialogProps {
  /** Source range the new pivot summarizes; the dialog shows it as `Source range: <cell range>`. */
  range: CellRange;
  busy: boolean;
  error?: string | null;
  onCreate(): void;
  onClose(): void;
}

/**
 * `Create pivot table` dialog of the `Data` menu (REQ-5-3-1). It names the source range and offers
 * the result location; `Create` adds the pivot worksheet with the default summary of that range.
 */
export function CreatePivotTableDialog({ range, busy, error, onCreate, onClose }: CreatePivotTableDialogProps) {
  return (
    <Dialog
      open
      title="Create pivot table"
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      actions={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={onCreate} disabled={busy}>Create</Button>
        </>
      )}
    >
      {error ? <p role="alert" className="ui-field__error">{error}</p> : null}
      <p className="pivot-dialog__source">Source range: {rangeLabel(range)}</p>
      <label className="ui-checkbox">
        <input type="radio" name="pivot-result-location" defaultChecked disabled={busy} />
        New worksheet
      </label>
    </Dialog>
  );
}

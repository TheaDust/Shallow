import { Dialog } from "../../ui/Dialog";
import { Button } from "../../ui/Button";

export interface DeleteWorksheetDialogProps {
  open: boolean;
  /** Name of the worksheet the confirmation targets, shown in the dialog text. */
  worksheetName: string;
  /** Disables the confirmation while the deletion request is in flight. */
  busy?: boolean;
  onClose(): void;
  onConfirm(): void;
}

/**
 * Confirmation shown by the tab menu's `Delete` command. The dialog names the
 * target worksheet and offers the "Delete worksheet" confirmation button; the
 * caller performs the deletion and closes the dialog on success or on a
 * rejected deletion.
 */
export function DeleteWorksheetDialog({
  open,
  worksheetName,
  busy = false,
  onClose,
  onConfirm,
}: DeleteWorksheetDialogProps) {
  if (!open) return null;
  return (
    <Dialog
      open
      title="Delete worksheet"
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <p className="delete-worksheet-message">
        {`"${worksheetName}" and its data, formulas, filters, validation and pivot results will be deleted.`}
      </p>
      <div className="form-actions">
        <Button variant="primary" disabled={busy} onClick={onConfirm}>
          Delete worksheet
        </Button>
      </div>
    </Dialog>
  );
}

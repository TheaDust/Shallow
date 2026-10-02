import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

export interface DeleteWorksheetDialogProps {
  /** Name of the worksheet the user is deleting; shown verbatim in the dialog text. */
  worksheetName: string;
  /** True while the delete request is in flight: the confirmation stays visible but disabled. */
  busy?: boolean;
  onConfirm(): void;
  onClose(): void;
}

/**
 * `Delete worksheet` confirmation (REQ-2-1-4). It describes the target worksheet by name and
 * asks for the same confirmation; the server decides whether the deletion is allowed, so a
 * refused delete only reports its message and leaves the workbook unchanged.
 */
export function DeleteWorksheetDialog({
  worksheetName,
  busy = false,
  onConfirm,
  onClose,
}: DeleteWorksheetDialogProps) {
  return (
    <Dialog
      open
      title="Delete worksheet"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      actions={
        <>
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy} onClick={onConfirm}>
            Delete worksheet
          </Button>
        </>
      }
    >
      <p>
        Delete the worksheet <strong>{worksheetName}</strong> and everything on it? Its data,
        formulas, filters, validation rules and pivot results are removed.
      </p>
    </Dialog>
  );
}

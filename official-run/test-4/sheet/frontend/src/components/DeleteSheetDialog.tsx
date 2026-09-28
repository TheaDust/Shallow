import { Dialog } from "./Dialog";

interface DeleteSheetDialogProps {
  /** Name of the worksheet the user wants to delete. */
  sheetName: string;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Confirmation dialog for deleting a worksheet (REQ-2-1-4). The dialog is
 * named "Delete worksheet", its visible text names the target worksheet, and
 * it provides a "Delete worksheet" confirmation button.
 */
export function DeleteSheetDialog({ sheetName, onConfirm, onClose }: DeleteSheetDialogProps) {
  return (
    <Dialog label="Delete worksheet" onClose={onClose}>
      <h2>Delete worksheet</h2>
      <p>
        Delete worksheet "{sheetName}"? This will permanently remove its data,
        formulas, filters, validation rules, and pivot results.
      </p>
      <div className="dialog-actions">
        <button type="button" className="secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={onConfirm}>
          Delete worksheet
        </button>
      </div>
    </Dialog>
  );
}

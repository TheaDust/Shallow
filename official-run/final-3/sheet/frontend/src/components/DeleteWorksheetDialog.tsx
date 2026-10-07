import { useRef, useState } from "react";

import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";

export interface DeleteWorksheetDialogProps {
  open: boolean;
  /** Name of the worksheet the confirmation describes. */
  worksheetName: string;
  onOpenChange(open: boolean): void;
  /**
   * Performs the deletion. The dialog closes whatever the outcome; a rejection
   * is reported by the caller while the target worksheet stays unchanged.
   */
  onDelete(): Promise<void>;
}

/**
 * Confirmation shown before a worksheet is deleted: named "Delete worksheet",
 * it describes the target worksheet and confirms through the equally named
 * "Delete worksheet" button.
 */
export function DeleteWorksheetDialog({
  open,
  worksheetName,
  onOpenChange,
  onDelete,
}: DeleteWorksheetDialogProps) {
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(open);

  // Every fresh opening starts from an enabled confirmation button again.
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onDelete();
    } finally {
      setBusy(false);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} title="Delete worksheet" onOpenChange={onOpenChange}>
      <p className="delete-worksheet__message">
        Delete the worksheet &quot;{worksheetName}&quot;? Its cells, formulas, filters, validation and pivot results
        will be removed.
      </p>
      <div className="delete-worksheet__actions">
        <Button variant="danger" disabled={busy} onClick={() => void confirm()}>
          Delete worksheet
        </Button>
      </div>
    </Dialog>
  );
}

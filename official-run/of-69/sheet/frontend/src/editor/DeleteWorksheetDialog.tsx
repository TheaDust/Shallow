import { useState } from "react";

import { ApiError } from "../lib/api";
import { deleteWorksheet } from "../domain/workbook-api";
import type { Workbook, Worksheet } from "../domain/types";
import { Button, Dialog } from "../ui";

/** Shown when the last remaining worksheet is the deletion target (REQ-2-1-4). */
export const LAST_WORKSHEET_MESSAGE = "A workbook must contain at least one worksheet";

export interface DeleteWorksheetDialogProps {
  workbookId: string;
  worksheet: Worksheet;
  onOpenChange(open: boolean): void;
  onDeleted(workbook: Workbook): void;
  onError(message: string): void;
}

/**
 * Confirmation dialog for one worksheet, mounted per target so its text names the target.
 * The dialog closes on both a successful deletion and a rejected one; a rejection is
 * reported to the page, which keeps both worksheets and their data unchanged.
 */
export function DeleteWorksheetDialog({
  workbookId,
  worksheet,
  onOpenChange,
  onDeleted,
  onError,
}: DeleteWorksheetDialogProps) {
  const [deleting, setDeleting] = useState(false);

  async function confirm() {
    if (deleting) return;
    setDeleting(true);
    try {
      const updated = await deleteWorksheet(workbookId, worksheet.id);
      onDeleted(updated);
      setDeleting(false);
      onOpenChange(false);
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : "Unable to delete the worksheet. Please try again.");
      setDeleting(false);
      onOpenChange(false);
    }
  }

  return (
    <Dialog
      open
      title="Delete worksheet"
      onOpenChange={onOpenChange}
      actions={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="danger" onClick={confirm} disabled={deleting}>
            Delete worksheet
          </Button>
        </>
      }
    >
      <p>
        {`Delete “${worksheet.name}”? Its data, formulas, filters, validation, and pivot results will be removed.`}
      </p>
    </Dialog>
  );
}

import { Button, Dialog } from "../ui";

export interface DeleteWorksheetDialogProps {
  open: boolean;
  /** Name of the worksheet the `Delete` command targeted; the dialog describes it by name. */
  worksheetName: string;
  busy: boolean;
  onClose(): void;
  /**
   * Confirmation. A refused deletion leaves both the workbook and the tab bar unchanged and reports
   * the message on the editor's error banner, so the dialog only asks and hands the request over.
   */
  onConfirm(): void;
}

/**
 * `Delete worksheet` confirmation of one worksheet tab (REQ-2-1-4): the dialog names the target
 * worksheet and asks for confirmation before its grid, formulas, rules, filters and pivot result
 * are removed. The `Delete worksheet` button performs the confirmed deletion.
 */
export function DeleteWorksheetDialog({
  open,
  worksheetName,
  busy,
  onClose,
  onConfirm,
}: DeleteWorksheetDialogProps) {
  return (
    <Dialog
      open={open}
      title="Delete worksheet"
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      actions={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>Delete worksheet</Button>
        </>
      )}
    >
      <p className="delete-worksheet__message">
        The worksheet <strong>{worksheetName}</strong> and its data, formulas, filters, validation
        and pivot results will be removed. This cannot be undone.
      </p>
    </Dialog>
  );
}

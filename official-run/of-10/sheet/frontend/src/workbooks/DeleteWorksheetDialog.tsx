import { useEffect, useState } from "react";

import { Button, Dialog } from "../ui";
import { requestErrorMessage } from "./api";
import { PIVOT_DEPENDENCY_MESSAGE } from "./worksheet-messages";

export interface DeleteWorksheetDialogProps {
  open: boolean;
  /** Name of the worksheet the confirmation targets; the dialog shows it as its visible subject. */
  worksheetName: string;
  onOpenChange(open: boolean): void;
  /** Runs the deletion; a rejection is reported by the server message. */
  onDelete(): Promise<void>;
  /** Runs after a successful deletion, so the page can drop its target. */
  onDeleted(): void;
  /**
   * Runs when the deletion was refused because a pivot table still reads the target: the dialog
   * closes and the page shows the message, so both worksheets keep their stored state.
   */
  onRefused(message: string): void;
}

/**
 * Confirmation of `Delete` in the worksheet tab menu (REQ-2-1-4). The dialog names its target, the
 * confirmation button runs the deletion, and any other failure is reported inside the dialog while
 * the tab and its grid stay as they are.
 */
export function DeleteWorksheetDialog({
  open,
  worksheetName,
  onOpenChange,
  onDelete,
  onDeleted,
  onRefused,
}: DeleteWorksheetDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setError(null);
    setBusy(false);
  }, [open, worksheetName]);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete();
      onDeleted();
      onOpenChange(false);
    } catch (caught) {
      const message = requestErrorMessage(caught);
      if (message === PIVOT_DEPENDENCY_MESSAGE) {
        onRefused(message);
        onOpenChange(false);
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title="Delete worksheet" onOpenChange={onOpenChange}>
      <div className="delete-worksheet rename-form">
        <p>
          Delete the worksheet <strong>{worksheetName}</strong>? Its cells, formulas, validation rules,
          filters and pivot results are removed.
        </p>
        {error ? (
          <p role="alert" className="ui-field__error">
            {error}
          </p>
        ) : null}
        <div className="rename-form__actions">
          <Button variant="primary" disabled={busy} onClick={() => void confirm()}>
            Delete worksheet
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

import type { FormEvent } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

export interface DeleteWorksheetDialogProps {
  /** Name of the worksheet the confirmation targets; shown inside the dialog text. */
  worksheetName: string;
  /** Error reported by the delete request; usually shown outside the dialog. */
  error?: string | null;
  busy?: boolean;
  onConfirm(): void;
  onOpenChange(open: boolean): void;
}

/**
 * "Delete worksheet" dialog (REQ-2-1-4): the confirmation names the target
 * worksheet and offers the `Delete worksheet` button. Nothing is removed until
 * that button is pressed, and the dialog cannot be dismissed while the request
 * is running.
 */
export function DeleteWorksheetDialog({
  worksheetName,
  error = null,
  busy = false,
  onConfirm,
  onOpenChange,
}: DeleteWorksheetDialogProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    onConfirm();
  }

  return (
    <Dialog
      open
      title="Delete worksheet"
      closeLabel="Close delete worksheet dialog"
      onOpenChange={(open) => {
        if (!open && busy) return;
        onOpenChange(open);
      }}
    >
      <form className="worksheet-delete" onSubmit={submit} noValidate>
        <p className="worksheet-delete__target">
          {`Delete the worksheet "${worksheetName}"? Its grid, formulas, filters, validation and pivot results will be removed.`}
        </p>
        {error ? <p role="alert" className="worksheet-delete__error">{error}</p> : null}
        <div className="worksheet-delete__actions">
          <Button type="submit" variant="primary" disabled={busy}>Delete worksheet</Button>
        </div>
        {busy ? <p role="status">Deleting worksheet…</p> : null}
      </form>
    </Dialog>
  );
}

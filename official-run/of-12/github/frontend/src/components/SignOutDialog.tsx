import { useEffect, useId, useRef } from "react";

import { Button } from "../ui";

export interface SignOutDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onConfirm(): void;
}

/**
 * Confirmation dialog for REQ-1-2. It is a native modal <dialog> so the page
 * behind it stays inoperable while it is open, and it exposes exactly the two
 * required buttons: "Confirm sign out" and "Cancel".
 */
export function SignOutDialog({ open, onOpenChange, onConfirm }: SignOutDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="ui-dialog sign-out-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
      onClose={() => {
        if (open) onOpenChange(false);
      }}
    >
      <div className="ui-dialog__surface">
        <h2 id={titleId}>Sign out</h2>
        <p className="ui-dialog__description">
          Signing out ends only the current browser session. Other sessions stay signed in.
        </p>
        <footer className="ui-dialog__actions">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            Confirm sign out
          </Button>
        </footer>
      </div>
    </dialog>
  );
}

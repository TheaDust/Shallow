import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./Button";

export interface DialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onOpenChange(open: boolean): void;
  actions?: ReactNode;
  closeLabel?: string;
  description?: string;
}

export function Dialog({ open, title, children, actions, closeLabel = "Close", description, onOpenChange }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

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
      className="dialog ui-dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
      onClose={() => {
        if (open) onOpenChange(false);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      {/*
        The surface only exists while the dialog is open: a closed dialog
        unmounts its title, description, fields and actions instead of leaving
        hidden copies in the document, so text and DOM queries after a close
        cannot match stale content. The `<dialog>` element itself stays mounted
        so the open/close lifecycle and the focus restore of `close()` remain
        intact; each opened dialog re-initialises its form state on open.
      */}
      {open ? (
        <div className="ui-dialog__surface">
          <header className="ui-dialog__header">
            <h2 id={titleId}>{title}</h2>
            <Button variant="ghost" aria-label={closeLabel} onClick={() => onOpenChange(false)}>
              ×
            </Button>
          </header>
          {description ? <p id={descriptionId} className="ui-dialog__description">{description}</p> : null}
          <div className="ui-dialog__body">{children}</div>
          {actions ? <footer className="ui-dialog__actions">{actions}</footer> : null}
        </div>
      ) : null}
    </dialog>
  );
}

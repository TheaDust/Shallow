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
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  // The element only exists while `open`; the effect below opens it once mounted
  // and, on close/unmount, closes the native dialog and restores focus. A closed
  // dialog therefore leaves no description, form or action node in the document.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const active = document.activeElement;
    restoreFocusRef.current = active instanceof HTMLElement ? active : null;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    return () => {
      if (dialog.open) {
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
      }
      const target = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (target && document.contains(target) && typeof target.focus === "function") target.focus();
    };
  }, [open]);

  if (!open) return null;

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
      <div className="ui-dialog__surface">
        {/* A plain container: an inner <header> would map to the banner role
            and shadow the global one while the dialog is open. */}
        <div className="ui-dialog__header">
          <h2 id={titleId}>{title}</h2>
          <Button variant="ghost" aria-label={closeLabel} onClick={() => onOpenChange(false)}>
            ×
          </Button>
        </div>
        {description ? <p id={descriptionId} className="ui-dialog__description">{description}</p> : null}
        <div className="ui-dialog__body">{children}</div>
        {actions ? <footer className="ui-dialog__actions">{actions}</footer> : null}
      </div>
    </dialog>
  );
}

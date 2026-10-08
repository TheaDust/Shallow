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
    if (!open) return;
    const dialog = dialogRef.current;
    const previouslyFocused =
      typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    return () => {
      // Removing a closed dialog from the DOM drops its modal isolation, so
      // hand focus back to whatever opened it.
      previouslyFocused?.focus();
    };
  }, [open]);

  // A closed dialog unmounts entirely: its description, form and actions must
  // not linger in the DOM where hidden text could shadow the visible page.
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
      onClick={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
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
    </dialog>
  );
}

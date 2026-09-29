import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button, type ButtonProps } from "./Button";

export interface PopoverProps {
  /** Visible text of the trigger; also its accessible name unless `triggerAriaLabel` is set. */
  triggerLabel: string;
  triggerAriaLabel?: string;
  triggerVariant?: ButtonProps["variant"];
  /** Accessible name of the panel the trigger opens. */
  label: string;
  children: (close: () => void) => ReactNode;
}

/**
 * Non-modal popover: a button that toggles a panel with `aria-expanded` /
 * `aria-controls`, closing on Escape or an outside pointer press. The page behind
 * stays usable, which is what the read-only clone popover (REQ-3-2-3) needs.
 */
export function Popover({
  triggerLabel,
  triggerAriaLabel,
  triggerVariant = "secondary",
  label,
  children,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentId = useId();

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  return (
    <div className="ui-popover" ref={rootRef}>
      <Button
        ref={triggerRef}
        variant={triggerVariant}
        aria-label={triggerAriaLabel}
        aria-expanded={open}
        aria-controls={open ? contentId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {triggerLabel}
      </Button>
      {open ? (
        <div
          id={contentId}
          role="group"
          aria-label={label}
          className="ui-popover__content"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

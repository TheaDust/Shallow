import { useEffect, useRef } from "react";

export interface ContextMenuItem {
  id: string;
  label: string;
  run(): void;
}

export interface ContextMenuProps {
  /** Accessible name of the menu. */
  label: string;
  /** Offset of the menu inside the grid wrapper. */
  position: { x: number; y: number };
  items: readonly ContextMenuItem[];
  onClose(): void;
}

/**
 * Menu opened by right-clicking inside the page (a cell, a row number or a column header). Each
 * command is a button with the menu item role; the first item takes the focus, the arrow keys move
 * between the items, Escape closes the menu and so does a click outside of it.
 */
export function ContextMenu({ label, position, items, onClose }: ContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstItemRef.current?.focus();
  }, []);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  }, [onClose]);

  const moveFocus = (step: number) => {
    const buttons = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? []);
    if (buttons.length === 0) return;
    const current = buttons.findIndex((button) => button === document.activeElement);
    const next = current < 0 ? 0 : (current + step + buttons.length) % buttons.length;
    buttons[next].focus();
  };

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label={label}
      className="sheet-menu"
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          moveFocus(1);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          moveFocus(-1);
        }
      }}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={index === 0 ? firstItemRef : undefined}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="ui-menu__item"
          onClick={() => {
            item.run();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface GridContextMenuItem {
  id: string;
  label: string;
  onSelect(): void;
}

export type GridContextMenuCloseReason = "select" | "escape" | "outside";

export interface GridContextMenuProps {
  label: string;
  /** Viewport coordinates of the right-click that opened the menu. */
  position: { x: number; y: number };
  items: readonly GridContextMenuItem[];
  onClose(reason: GridContextMenuCloseReason): void;
}

/**
 * The context menu of a grid target (row number, column header or cell). It follows the shared menu
 * keyboard model (arrow keys, Home/End, Escape) and renders in a portal so the scrollable grid
 * cannot clip it.
 */
export function GridContextMenu({ label, position, items, onClose }: GridContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    itemRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose("outside");
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [onClose]);

  const focusItem = (index: number) => {
    const count = items.length;
    if (!count) return;
    itemRefs.current[((index % count) + count) % count]?.focus();
  };

  const currentIndex = () => itemRefs.current.indexOf(document.activeElement as HTMLButtonElement | null);

  return createPortal(
    <div
      ref={rootRef}
      role="menu"
      aria-label={label}
      className="grid-menu"
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        switch (event.key) {
          case "ArrowDown": event.preventDefault(); focusItem(currentIndex() + 1); break;
          case "ArrowUp": event.preventDefault(); focusItem(currentIndex() - 1); break;
          case "Home": event.preventDefault(); focusItem(0); break;
          case "End": event.preventDefault(); focusItem(items.length - 1); break;
          case "Escape": event.preventDefault(); onClose("escape"); break;
          default: break;
        }
      }}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(node) => { itemRefs.current[index] = node; }}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="ui-menu__item"
          onClick={() => {
            item.onSelect();
            onClose("select");
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

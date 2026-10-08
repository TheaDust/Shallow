import { useEffect, useRef } from "react";

export interface ContextMenuItem {
  id: string;
  label: string;
  onSelect(): void;
}

export interface ContextMenuProps {
  /** Accessible name of the menu. */
  label: string;
  items: readonly ContextMenuItem[];
  /** Viewport coordinates of the pointer that opened the menu. */
  position: { x: number; y: number };
  onClose(): void;
}

/**
 * Menu opened by a context action (for example right-clicking a grid header).
 * It carries the ARIA menu/menuitem roles with arrow-key navigation and closes
 * on Escape or on a pointer press outside the menu.
 */
export function ContextMenu({ label, items, position, onClose }: ContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    itemRefs.current[0]?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [onClose]);

  const focusItem = (index: number) => {
    if (!items.length) return;
    itemRefs.current[(index + items.length) % items.length]?.focus();
  };

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label={label}
      className="ui-menu__content ui-menu__content--context"
      style={{ top: position.y, left: position.x }}
      onKeyDown={(event) => {
        const current = itemRefs.current.findIndex((node) => node === document.activeElement);
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          focusItem(current + (event.key === "ArrowDown" ? 1 : -1));
        } else if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(node) => {
            itemRefs.current[index] = node;
          }}
          type="button"
          role="menuitem"
          className="ui-menu__item"
          tabIndex={-1}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

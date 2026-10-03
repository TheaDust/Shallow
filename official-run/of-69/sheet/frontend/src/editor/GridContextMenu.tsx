import { useEffect, useRef } from "react";

export interface GridMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  onSelect(): void;
}

export interface GridContextMenuProps {
  /** Accessible name of the menu. */
  label: string;
  /** Viewport coordinates of the pointer that opened the menu. */
  x: number;
  y: number;
  items: readonly GridMenuItem[];
  onClose(): void;
}

/**
 * Context menu for the grid headers: a `role="menu"` positioned at the pointer whose
 * commands are `role="menuitem"` buttons.
 */
export function GridContextMenu({ label, x, y, items, onClose }: GridContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusItem = (index: number) => {
    const enabled = itemRefs.current
      .map((node, itemIndex) => ({ node, itemIndex }))
      .filter(({ node }) => node && !node.disabled);
    if (!enabled.length) return;
    enabled[(index + enabled.length) % enabled.length].node?.focus();
  };

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", closeOutside);
    const first = itemRefs.current.find((node) => node && !node.disabled);
    first?.focus();
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label={label}
      className="grid-context-menu"
      style={{ left: `${x}px`, top: `${y}px` }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const current = itemRefs.current.findIndex((node) => node === document.activeElement);
          focusItem(current + (event.key === "ArrowDown" ? 1 : -1));
          return;
        }
        if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          focusItem(event.key === "Home" ? 0 : -1);
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
          className="grid-context-menu__item"
          disabled={item.disabled}
          tabIndex={-1}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

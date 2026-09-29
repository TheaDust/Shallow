import { useEffect, useRef } from "react";

export interface GridMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface GridContextMenuProps {
  /** Viewport coordinates of the element the menu was opened from. */
  x: number;
  y: number;
  /** Accessible name of the menu. */
  label: string;
  items: readonly GridMenuItem[];
  onSelect(id: string): void;
  onClose(): void;
}

const MENU_WIDTH = 200;
const MENU_ITEM_HEIGHT = 38;

/**
 * Non-modal menu opened from the grid (right click or the context-menu key). It
 * owns no trigger of its own, so the accessible name of the element it was
 * opened from stays the plain row number, column letter or cell coordinate.
 */
export function GridContextMenu({ x, y, label, items, onSelect, onClose }: GridContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    itemRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose]);

  const focusItem = (index: number) => {
    const count = items.length;
    if (count === 0) return;
    itemRefs.current[((index % count) + count) % count]?.focus();
  };

  const left = Math.max(4, Math.min(x, (window.innerWidth || 0) - MENU_WIDTH - 8));
  const top = Math.max(4, Math.min(y, (window.innerHeight || 0) - items.length * MENU_ITEM_HEIGHT - 8));

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      className="ui-menu__content worksheet-grid__context-menu"
      style={{ left, top }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const current = itemRefs.current.findIndex((node) => node === document.activeElement);
          focusItem(current + (event.key === "ArrowDown" ? 1 : -1));
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          focusItem(event.key === "Home" ? 0 : -1);
        } else if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        } else if (event.key === "Tab") {
          onClose();
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
          disabled={item.disabled}
          className="ui-menu__item"
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

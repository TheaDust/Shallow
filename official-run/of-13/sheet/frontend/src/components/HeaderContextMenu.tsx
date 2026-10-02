import { useEffect, useRef } from "react";

export interface HeaderMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  onSelect(): void;
}

export interface HeaderContextMenuProps {
  /** Accessible name of the menu, e.g. `Row 3 options`. */
  label: string;
  /** Viewport coordinates of the right-click that opened the menu. */
  x: number;
  y: number;
  items: readonly HeaderMenuItem[];
  onClose(): void;
  /** Element that receives focus again once the menu closes. */
  returnFocus?: HTMLElement | null;
}

/**
 * Floating menu opened by right-clicking a row number or a column header. It keeps the
 * ARIA menu/menuitem contract and the usual menu keyboard behaviour (Arrow keys, Home,
 * End, Escape, outside click) while the commands themselves stay plain buttons.
 */
export function HeaderContextMenu({ label, x, y, items, onClose, returnFocus }: HeaderContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const enabledIndexes = items
    .map((item, index) => (item.disabled ? -1 : index))
    .filter((index) => index >= 0);

  const focusAt = (offset: number) => {
    if (!enabledIndexes.length) return;
    const position = (offset + enabledIndexes.length) % enabledIndexes.length;
    itemRefs.current[enabledIndexes[position]]?.focus();
  };

  useEffect(() => {
    focusAt(0);
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    onClose();
    returnFocus?.focus();
  };

  const currentIndex = () => itemRefs.current.findIndex((node) => node === document.activeElement);

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label={label}
      className="header-menu"
      style={{ left: x, top: y }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const position = enabledIndexes.indexOf(currentIndex());
          focusAt(position + (event.key === "ArrowDown" ? 1 : -1));
        } else if (event.key === "Home") {
          event.preventDefault();
          focusAt(0);
        } else if (event.key === "End") {
          event.preventDefault();
          focusAt(-1);
        } else if (event.key === "Escape") {
          event.preventDefault();
          close();
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
          className="ui-menu__item header-menu__item"
          disabled={item.disabled}
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

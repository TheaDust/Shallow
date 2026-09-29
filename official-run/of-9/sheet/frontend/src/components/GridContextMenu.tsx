import { useEffect, useId, useRef } from "react";

export interface GridContextMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  onSelect(): void;
}

export interface GridContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  label: string;
  items: readonly GridContextMenuItem[];
  onClose(): void;
}

function clampPosition(value: number, max: number): number {
  return Math.max(0, Math.min(value, max));
}

export function GridContextMenu({ open, x, y, label, items, onClose }: GridContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current.find((item) => item && !item.disabled)?.focus();
  }, [open]);

  if (!open) return null;

  const left = clampPosition(x, window.innerWidth - 180);
  const top = clampPosition(y, window.innerHeight - items.length * 36 - 12);

  return (
    <div
      ref={rootRef}
      id={menuId}
      role="menu"
      aria-label={label}
      className="ui-menu__content grid-context-menu"
      style={{ position: "fixed", left, top, zIndex: 30 }}
      onKeyDown={(event) => {
        const enabled = items.map((item, index) => (item.disabled ? -1 : index)).filter((index) => index >= 0);
        const current = enabled.indexOf(
          itemRefs.current.findIndex((node) => node === document.activeElement),
        );
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const next = enabled[current + (event.key === "ArrowDown" ? 1 : -1)];
          if (next !== undefined) itemRefs.current[next]?.focus();
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          const index = event.key === "Home" ? enabled[0] : enabled[enabled.length - 1];
          if (index !== undefined) itemRefs.current[index]?.focus();
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
          tabIndex={-1}
          className="ui-menu__item"
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

import { useEffect, useId, useRef } from "react";import type { MenuItem } from "./Menu";

export interface ContextMenuProps {
  /** Accessible name of the menu, e.g. "Row 2 menu". */
  label: string;
  /** Viewport coordinates where the menu opens (the pointer position). */
  x: number;
  y: number;
  items: readonly MenuItem[];
  onClose(): void;
}

/**
 * Pointer-opened menu (right click on a grid header). Exposes the ARIA
 * `menu`/`menuitem` roles, moves focus to the first command on open, closes on
 * Escape or on a pointer press outside, and returns focus to the invoker.
 */
export function ContextMenu({ label, x, y, items, onClose }: ContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const menuId = useId();

  useEffect(() => {
    const focusTarget = itemRefs.current.find((node) => node && !node.disabled);
    focusTarget?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onCloseRef.current();
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  const moveFocus = (from: number, step: number) => {
    const enabled = itemRefs.current
      .map((node, index) => ({ node, index }))
      .filter((entry) => entry.node && !entry.node.disabled);
    if (!enabled.length) return;
    const current = enabled.findIndex((entry) => entry.index === from);
    const next = (current + step + enabled.length) % enabled.length;
    enabled[next].node?.focus();
  };

  const activeIndex = () => itemRefs.current.findIndex((node) => node === document.activeElement);

  return (
    <div
      ref={rootRef}
      id={menuId}
      role="menu"
      aria-label={label}
      className="ui-context-menu"
      style={{ left: x, top: y }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          moveFocus(activeIndex(), event.key === "ArrowDown" ? 1 : -1);
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          moveFocus(-1, event.key === "Home" ? 0 : -1);
        } else if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(node) => {
            itemRefs.current[index] = node;
          }}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          tabIndex={-1}
          data-tone={item.tone ?? "default"}
          className="ui-context-menu__item"
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

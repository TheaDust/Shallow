import { useEffect, useRef } from "react";

import type { MenuItem } from "./Menu";

export interface ContextMenuProps {
  /** Accessible name of the `menu` (the row number or column letter it acts on). */
  label: string;
  items: readonly MenuItem[];
  /** Viewport coordinates of the pointer that opened the menu. */
  position: { x: number; y: number };
  onClose(): void;
}

/**
 * Pointer-anchored menu used by the grid headers (REQ-2-2). Commands are
 * `menuitem` buttons; the menu is keyboard navigable (arrow keys, Home/End,
 * Escape) and closes on an outside pointer press so it never blocks the page.
 */
export function ContextMenu({ label, items, position, onClose }: ContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focused = useRef(false);

  const enabledItems = () => itemRefs.current.filter(
    (node): node is HTMLButtonElement => node !== null && !node.disabled,
  );

  useEffect(() => {
    // Focus the first command once per opened menu; later re-renders keep the
    // command the user arrowed to focused.
    if (!focused.current) {
      focused.current = true;
      enabledItems()[0]?.focus();
    }
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [items, onClose]);

  const focusItem = (delta: number) => {
    const enabled = enabledItems();
    if (!enabled.length) return;
    const current = enabled.findIndex((node) => node === document.activeElement);
    const next = (current + delta + enabled.length) % enabled.length;
    enabled[next]?.focus();
  };

  const focusEdge = (edge: "first" | "last") => {
    const enabled = enabledItems();
    (edge === "first" ? enabled[0] : enabled[enabled.length - 1])?.focus();
  };

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label={label}
      className="ui-context-menu"
      style={{ left: position.x, top: position.y }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          focusItem(1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          focusItem(-1);
        } else if (event.key === "Home") {
          event.preventDefault();
          focusEdge("first");
        } else if (event.key === "End") {
          event.preventDefault();
          focusEdge("last");
        }
      }}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(node) => { itemRefs.current[index] = node; }}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          className="ui-menu__item"
          data-tone={item.tone ?? "default"}
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

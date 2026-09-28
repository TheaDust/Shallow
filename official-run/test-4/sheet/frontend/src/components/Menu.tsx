import { useEffect, useRef, useState } from "react";

export interface MenuAction {
  label: string;
  onSelect: () => void;
}

interface MenuProps {
  actions: MenuAction[];
  /** Preferred screen position (client coordinates) of the menu. */
  x: number;
  y: number;
  onClose: () => void;
}

/**
 * A popup menu whose commands expose the ARIA menuitem role with keyboard
 * navigation (Arrow keys, Home/End, Enter, Escape). It is rendered as an
 * absolutely-positioned overlay and closes on Escape, outside pointer
 * interaction, or after a command is chosen.
 */
export function Menu({ actions, x, y, onClose }: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const menu = menuRef.current;
    if (menu) {
      const rect = menu.getBoundingClientRect();
      const left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 4));
      const top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 4));
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    }
    const items = Array.from(
      menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    items[activeIndex]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const next = (activeIndex + direction + actions.length) % actions.length;
        setActiveIndex(next);
        items[next]?.focus();
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setActiveIndex(0);
        items[0]?.focus();
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setActiveIndex(actions.length - 1);
        items[actions.length - 1]?.focus();
        return;
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!menu?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [actions, activeIndex, onClose, x, y]);

  return (
    <div
      ref={menuRef}
      role="menu"
      className="context-menu"
      style={{ left: x, top: y }}
      data-testid="context-menu"
    >
      {actions.map((action, index) => (
        <button
          key={action.label}
          type="button"
          role="menuitem"
          className="menu-item"
          tabIndex={index === activeIndex ? 0 : -1}
          onClick={() => {
            onClose();
            action.onSelect();
          }}
          onMouseEnter={() => setActiveIndex(index)}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

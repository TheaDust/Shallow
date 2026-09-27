import { useEffect, useRef } from "react";

export interface WorksheetMenuItem {
  label: string;
  onSelect: () => void;
}

export interface WorksheetMenuProps {
  items: WorksheetMenuItem[];
  onClose: () => void;
}

/**
 * Dropdown menu opened from a worksheet tab. Commands use the ARIA menuitem
 * role and support ArrowUp/ArrowDown/Home/End navigation, Enter/Space to
 * activate, and Escape/Tab to close.
 */
export default function WorksheetMenu({ items, onClose }: WorksheetMenuProps) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    itemRefs.current[0]?.focus();
  }, []);

  function focusIndex(index: number) {
    const next = (index + items.length) % items.length;
    itemRefs.current[next]?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusIndex(current + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusIndex(current - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusIndex(items.length - 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab") {
      onClose();
    }
  }

  return (
    <>
      <div className="menu-backdrop" onClick={onClose} />
      <div role="menu" className="worksheet-menu" onKeyDown={handleKeyDown}>
        {items.map((item, index) => (
          <button
            key={item.label}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            type="button"
            role="menuitem"
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
    </>
  );
}

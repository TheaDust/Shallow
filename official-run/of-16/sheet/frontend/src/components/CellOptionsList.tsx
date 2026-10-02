import { useEffect, useRef } from "react";

/**
 * Options popup of one dropdown cell (REQ-5-2-1).
 *
 * A `listbox` anchored at the `Open dropdown for <coordinate>` button; every
 * option uses the ARIA `option` role and its accessible name is the trimmed
 * allowed value. The list closes on selection, on Escape and on any pointer
 * press outside it, and returns focus to the button that opened it.
 */
export interface CellOptionsListProps {
  /** Accessible name of the listbox, for example `Options for A2`. */
  label: string;
  values: readonly string[];
  /** Viewport coordinates of the button that opened the list. */
  position: { x: number; y: number };
  current?: string;
  onSelect(value: string): void;
  onClose(): void;
  /** Anchor to focus again when the list closes. */
  returnFocus?: HTMLElement | null;
}

export function CellOptionsList({
  label,
  values,
  position,
  current = "",
  onSelect,
  onClose,
  returnFocus = null,
}: CellOptionsListProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    optionRefs.current[values.findIndex((value) => value === current)]?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onClose();
        returnFocus?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [values, current, onClose, returnFocus]);

  const focusOption = (delta: number) => {
    const nodes = optionRefs.current.filter((node): node is HTMLDivElement => node !== null);
    if (!nodes.length) return;
    const active = nodes.findIndex((node) => node === document.activeElement);
    const next = (Math.max(active, 0) + delta + nodes.length) % nodes.length;
    nodes[next]?.focus();
  };

  return (
    <div
      ref={rootRef}
      role="listbox"
      aria-label={label}
      className="cell-options"
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          focusOption(event.key === "ArrowDown" ? 1 : -1);
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          const nodes = optionRefs.current.filter((node): node is HTMLDivElement => node !== null);
          (event.key === "Home" ? nodes[0] : nodes[nodes.length - 1])?.focus();
        } else if (event.key === "Escape") {
          event.preventDefault();
          onClose();
          returnFocus?.focus();
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          const active = (event.target as HTMLElement).getAttribute("data-value");
          if (active !== null) onSelect(active);
        }
      }}
    >
      {values.map((value, index) => (
        <div
          key={value}
          ref={(node) => { optionRefs.current[index] = node; }}
          role="option"
          aria-selected={value === current}
          aria-label={value}
          data-value={value}
          tabIndex={-1}
          className="cell-options__option"
          onClick={() => onSelect(value)}
        >
          {value}
        </div>
      ))}
    </div>
  );
}

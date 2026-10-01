import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";

export interface CellDropdownProps {
  /** Coordinate of the cell this dropdown belongs to (`A1`), used by the button's accessible name. */
  coordinate: string;
  values: readonly string[];
  currentValue: string;
  disabled?: boolean;
  onSelect(value: string): void;
}

/**
 * Dropdown of a cell that a `Dropdown` validation rule covers (REQ-5-2). The cell keeps its value;
 * the button only offers the rule's allowed values, and choosing one writes the cell through the
 * ordinary commit path, so the server re-checks the rule.
 */
export function CellDropdown({ coordinate, values, currentValue, disabled, onSelect }: CellDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const selected = listRef.current?.querySelector<HTMLElement>("[role='option'][aria-selected='true']");
    (selected ?? listRef.current?.querySelector<HTMLElement>("[role='option']"))?.focus();
  }, [open]);

  const choose = (value: string) => {
    setOpen(false);
    onSelect(value);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    const options = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[role='option']") ?? []);
    const index = options.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = index + (event.key === "ArrowDown" ? 1 : -1);
      options[(next + options.length) % options.length]?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.getAttribute("role") === "option") {
        event.preventDefault();
        choose(active.textContent ?? "");
      }
    }
  };

  const stop = (event: ReactMouseEvent<HTMLElement>) => event.stopPropagation();

  return (
    <div className="cell-dropdown" ref={rootRef}>
      <button
        type="button"
        className="cell-dropdown__button"
        aria-label={`Open dropdown for ${coordinate}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onMouseDown={stop}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span aria-hidden="true" className="cell-dropdown__caret" />
      </button>
      {open ? (
        <div
          ref={listRef}
          className="cell-dropdown__list"
          role="listbox"
          aria-label={`Options for ${coordinate}`}
          onMouseDown={stop}
          onClick={stop}
          onKeyDown={handleKeyDown}
        >
          {values.map((value) => (
            <div
              key={value}
              role="option"
              tabIndex={-1}
              aria-selected={value === currentValue.trim()}
              className="cell-dropdown__option"
              onClick={() => choose(value)}
            >
              {value}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";

export interface CellDropdownProps {
  /** Coordinate of the cell the dropdown writes to, used for the accessible names. */
  cellId: string;
  /** Trimmed allowed values of the dropdown rule, in their stored order. */
  values: readonly string[];
  /** Value currently stored in the cell, marked as the selected option. */
  currentValue: string;
  onSelect(value: string): void;
}

/**
 * Dropdown a validated cell provides: a button with the accessible name `Open dropdown for <cell
 * coordinate>` opening a listbox of the trimmed allowed values. Selecting one writes it through the
 * normal cell write, so a rule is enforced by the same path as any other edit.
 */
export function CellDropdown({ cellId, values, currentValue, onSelect }: CellDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <span className="cell-dropdown" ref={rootRef}>
      <button
        type="button"
        className="cell-dropdown__button"
        aria-label={`Open dropdown for ${cellId}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      />
      {open ? (
        <span role="listbox" aria-label={`Options for ${cellId}`} className="cell-dropdown__list">
          {values.map((value) => (
            <button
              key={value}
              type="button"
              role="option"
              aria-selected={value === currentValue}
              className="cell-dropdown__option"
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                onSelect(value);
              }}
            >
              {value}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

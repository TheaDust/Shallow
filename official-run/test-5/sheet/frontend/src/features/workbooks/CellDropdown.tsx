import { useEffect, useRef } from "react";

export interface CellDropdownProps {
  /** Coordinate of the cell the options belong to. */
  address: string;
  /** Allowed values of the dropdown rule, already trimmed. */
  values: readonly string[];
  /** Current displayed value of the cell, marked as selected. */
  current: string;
  disabled?: boolean;
  onSelect(value: string): void;
  onClose(): void;
}

/**
 * Option list of a dropdown cell (REQ-5-2-1). Every option uses the ARIA option
 * role and the trimmed allowed value as its accessible name; choosing one
 * writes that value through the regular cell path, so an invalid value is still
 * rejected by the server.
 */
export function CellDropdown({
  address,
  values,
  current,
  disabled = false,
  onSelect,
  onClose,
}: CellDropdownProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      role="listbox"
      aria-label={`Values for ${address}`}
      className="worksheet-grid__dropdown"
    >
      {values.map((value) => (
        <div
          key={value}
          role="option"
          aria-selected={value === current}
          aria-disabled={disabled || undefined}
          tabIndex={0}
          className="worksheet-grid__dropdown-option"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (disabled) return;
            onSelect(value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            if (disabled) return;
            onSelect(value);
          }}
        >
          {value}
        </div>
      ))}
    </div>
  );
}

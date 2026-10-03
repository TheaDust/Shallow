import { useEffect, useId, useRef } from "react";

export interface DropdownOptionsProps {
  /** Accessible name of the listbox, e.g. `Options for A2`. */
  label: string;
  /** Viewport coordinates where the list opens. */
  x: number;
  y: number;
  values: readonly string[];
  onSelect(value: string): void;
  onClose(): void;
}

/**
 * Options of a dropdown-validated cell. Every value of the rule is a
 * `role="option"` element named after the trimmed allowed value, so the
 * allowed values are reachable without relying on a browser-native popup.
 */
export function DropdownOptions({ label, x, y, values, onSelect, onClose }: DropdownOptionsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const listboxId = useId();

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onCloseRef.current();
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  return (
    <div
      ref={rootRef}
      id={listboxId}
      role="listbox"
      aria-label={label}
      className="ui-context-menu dropdown-options"
      style={{ left: x, top: y }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      {values.map((value) => (
        <button
          key={value}
          type="button"
          role="option"
          aria-selected={false}
          tabIndex={-1}
          className="ui-context-menu__item"
          onClick={() => {
            onSelect(value);
            onClose();
          }}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

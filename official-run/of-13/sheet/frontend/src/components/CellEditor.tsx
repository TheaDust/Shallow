import { useEffect, useRef, type KeyboardEvent } from "react";

export interface CellEditorProps {
  /** Cell coordinate being edited; the accessible name is `Edit <address>`. */
  address: string;
  /** Current text of the edit, owned by the editor page so the formula bar stays in sync. */
  value: string;
  onChange(value: string): void;
  /** True while the previous commit is still in flight: the same box stays, disabled. */
  busy?: boolean;
  onCommit(value: string): void;
  onCancel(): void;
}

/**
 * Inline text box shown inside a grid cell while it is edited in place. It commits on
 * Enter and on losing focus (clicking another cell commits the change) and cancels on
 * Escape; either way it reports exactly once so the caller's state stays consistent.
 */
export function CellEditor({
  address,
  value,
  onChange,
  busy = false,
  onCommit,
  onCancel,
}: CellEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const settled = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  function settle(action: () => void) {
    if (settled.current) return;
    settled.current = true;
    action();
  }

  return (
    <input
      ref={inputRef}
      className="worksheet-grid__editor"
      type="text"
      aria-label={`Edit ${address}`}
      value={value}
      disabled={busy}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        // Keep grid navigation (arrows, typing shortcuts) out of the editor.
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          settle(() => onCommit(value));
        } else if (event.key === "Escape") {
          event.preventDefault();
          settle(onCancel);
        }
      }}
      onBlur={() => settle(() => onCommit(value))}
    />
  );
}

import { useId } from "react";

export interface FormulaBarProps {
  /** Raw content of the current cell, or the draft while it is being edited. */
  value: string;
  onChange(value: string): void;
  onCommit(): void;
  onCancel(): void;
}

/**
 * The text box labelled "Formula bar". It mirrors the selected cell: ordinary
 * cells show their text and formula cells show the original expression. Enter
 * commits the typed value, Escape cancels it and leaves the last successful
 * content in place.
 */
export function FormulaBar({ value, onChange, onCommit, onCancel }: FormulaBarProps) {
  const id = useId();
  return (
    <div className="formula-bar">
      <label htmlFor={id}>Formula bar</label>
      <input
        id={id}
        className="formula-bar__input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => onCommit()}
      />
    </div>
  );
}

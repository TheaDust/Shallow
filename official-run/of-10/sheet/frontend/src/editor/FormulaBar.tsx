import { useId } from "react";

export interface FormulaBarProps {
  cellId: string;
  value: string;
  onChange(value: string): void;
  onCommit(): void;
  onCancel(): void;
}

/**
 * Shows the raw content of the current cell and commits the typed text back to that cell.
 * Enter and leaving the field both commit; Escape restores the stored content.
 */
export function FormulaBar({ cellId, value, onChange, onCommit, onCancel }: FormulaBarProps) {
  const inputId = useId();
  return (
    <div className="formula-bar">
      <span className="formula-bar__address">{cellId}</span>
      <label className="formula-bar__label" htmlFor={inputId}>
        fx
      </label>
      <input
        id={inputId}
        className="formula-bar__input"
        type="text"
        aria-label="Formula bar"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
    </div>
  );
}

import { useEffect, useRef, useState } from "react";

import { FormField } from "../../ui";

export const FORMULA_BAR_FIELD_ID = "formula-bar-input";

export interface FormulaBarProps {
  /** Coordinate the text box edits; it determines where a commit is written. */
  cellAddress: string;
  /** Raw text of that cell: the ordinary value or the original formula. */
  value: string;
  disabled?: boolean;
  /** Bumping this value re-syncs the draft with the last successful content. */
  revision?: number;
  /** Commits the typed text to the cell that was being edited. */
  onCommit(address: string, text: string): void;
}

/**
 * Text box labeled "Formula bar". It shows the raw content of the selected cell
 * and edits it directly: Enter or moving focus away commits the typed text,
 * Escape discards the uncommitted change and restores the last successful one.
 */
export function FormulaBar({ cellAddress, value, disabled = false, revision = 0, onCommit }: FormulaBarProps) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  /** Cell the current draft belongs to, so a click elsewhere commits the right one. */
  const targetRef = useRef(cellAddress);

  useEffect(() => {
    setDraft(value);
    setDirty(false);
    targetRef.current = cellAddress;
  }, [cellAddress, value, revision]);

  const commit = () => {
    const address = targetRef.current;
    const text = draft;
    setDirty(false);
    onCommit(address, text);
  };

  return (
    <div className="formula-bar">
      <FormField id={FORMULA_BAR_FIELD_ID} label="Formula bar">
        <input
          id={FORMULA_BAR_FIELD_ID}
          type="text"
          value={draft}
          disabled={disabled}
          onFocus={() => { targetRef.current = cellAddress; }}
          onChange={(event) => {
            targetRef.current = cellAddress;
            setDraft(event.target.value);
            setDirty(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setDraft(value);
              setDirty(false);
            }
          }}
          onBlur={() => {
            if (dirty) commit();
          }}
        />
      </FormField>
    </div>
  );
}

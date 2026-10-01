import { useEffect, useRef, useState } from "react";

export interface FormulaBarProps {
  cellReference: string;
  value: string;
  busy: boolean;
  onCommit(value: string): Promise<boolean>;
}

export function FormulaBar({ cellReference, value, busy, onCommit }: FormulaBarProps) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const skipBlurRef = useRef(false);

  useEffect(() => {
    draftRef.current = value;
    setDraft(value);
  }, [value, cellReference]);

  const commit = async () => {
    if (draftRef.current === value) return true;
    const success = await onCommit(draftRef.current);
    if (!success) {
      draftRef.current = value;
      setDraft(value);
    }
    return success;
  };

  return (
    <div className="formula-bar">
      <span className="formula-bar__reference" aria-hidden="true">{cellReference}</span>
      <label className="formula-bar__label" htmlFor="formula-bar-input">Formula bar</label>
      <input
        id="formula-bar-input"
        className="formula-bar__input"
        type="text"
        value={draft}
        disabled={busy}
        onChange={(event) => {
          draftRef.current = event.target.value;
          setDraft(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            skipBlurRef.current = true;
            draftRef.current = value;
            setDraft(value);
          }
        }}
        onBlur={() => {
          if (skipBlurRef.current) {
            skipBlurRef.current = false;
            return;
          }
          void commit();
        }}
      />
    </div>
  );
}

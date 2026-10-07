import { useState } from "react";

export interface FormulaBarProps {
  /** Committed raw text of the current cell (formula text or ordinary value). */
  value: string;
  /** A1-style coordinate of the current cell. */
  coordinate: string;
  /** Called with the coordinate and its new raw text when the edit is committed. */
  onCommit?(coordinate: string, value: string): void;
}

/**
 * Editable formula bar for the current cell. Typing keeps a local draft; the
 * change is committed with Enter, with Escape it is discarded, and losing focus
 * (for example clicking another cell) also commits it. The shown text
 * resynchronizes with the stored value whenever the selection changes or the
 * cell is updated elsewhere, so a committed value and the bar stay consistent.
 */
export function FormulaBar({ value, coordinate, onCommit }: FormulaBarProps) {
  const [state, setState] = useState({ coordinate, draft: value, dirty: false });

  if (state.coordinate !== coordinate) {
    setState({ coordinate, draft: value, dirty: false });
  } else if (!state.dirty && state.draft !== value) {
    setState({ coordinate, draft: value, dirty: false });
  }

  const commit = () => {
    const draft = state.draft;
    setState({ coordinate, draft, dirty: false });
    onCommit?.(coordinate, draft);
  };

  return (
    <div className="formula-bar">
      <span className="formula-bar__reference" aria-hidden="true">{coordinate}</span>
      <label className="formula-bar__label" htmlFor="formula-bar-input">Formula bar</label>
      <input
        id="formula-bar-input"
        className="formula-bar__input"
        type="text"
        value={state.draft}
        onChange={(event) => setState({ coordinate, draft: event.target.value, dirty: true })}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setState({ coordinate, draft: value, dirty: false });
          }
        }}
        onBlur={() => {
          if (state.dirty) commit();
        }}
      />
    </div>
  );
}

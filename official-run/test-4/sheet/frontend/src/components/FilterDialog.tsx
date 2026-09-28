import { useState } from "react";

import { Dialog } from "./Dialog";
import { CONDITION_OPTIONS, CONDITION_USES_VALUE, type ColumnFilter } from "../lib/filter";

interface FilterDialogProps {
  headerText: string;
  /** Column letter the dialog filters (e.g. "A"). */
  column: string;
  /** Distinct non-empty source values for the column (excluding the header). */
  values: string[];
  /** Current filter state for this column, if any. */
  current?: ColumnFilter;
  onApply: (columnFilter: ColumnFilter) => Promise<void>;
  onClose: () => void;
}

/**
 * The "Filter <header text>" dialog (REQ-5-1-2). It supports selecting
 * specific values through checkboxes (each named by its displayed source
 * value) and condition options "Text contains", "Greater than", "Before",
 * "Is empty", and "Is not empty" via the "Condition" combo box; conditions
 * that need it use the "Value" text box. "Apply" persists the column filter.
 */
export function FilterDialog({
  headerText,
  column,
  values,
  current,
  onApply,
  onClose,
}: FilterDialogProps) {
  const initialCondition =
    current && current.kind === "condition" ? current.condition : "None";
  const [condition, setCondition] = useState<string>(initialCondition);
  const [valueText, setValueText] = useState<string>(
    current && current.kind === "condition" ? current.value : "",
  );
  const [selected, setSelected] = useState<string[]>(
    current && current.kind === "values" ? current.selected : [...values],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const usesValue = condition !== "None" && CONDITION_USES_VALUE.has(condition);
  const showValues = condition === "None";

  function toggleValue(value: string) {
    setSelected((currentSelected) =>
      currentSelected.includes(value)
        ? currentSelected.filter((item) => item !== value)
        : [...currentSelected, value],
    );
  }

  async function apply() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const columnFilter: ColumnFilter =
      condition === "None"
        ? { kind: "values", selected }
        : { kind: "condition", condition, value: valueText };
    try {
      await onApply(columnFilter);
      onClose();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : String(applyError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog label={`Filter ${headerText}`} onClose={onClose}>
      <h2>Filter {headerText}</h2>

      <div className="dialog-field">
        <label htmlFor={`filter-condition-${column}`}>Condition</label>
        <select
          id={`filter-condition-${column}`}
          value={condition}
          onChange={(event) => setCondition(event.target.value)}
        >
          <option value="None">None</option>
          {CONDITION_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      {usesValue && (
        <div className="dialog-field">
          <label htmlFor={`filter-value-${column}`}>Value</label>
          <input
            id={`filter-value-${column}`}
            type="text"
            value={valueText}
            onChange={(event) => setValueText(event.target.value)}
          />
        </div>
      )}

      {showValues && (
        <div className="dialog-field filter-values">
          <button
            type="button"
            className="clear-selection"
            onClick={() => setSelected([])}
          >
            Clear selection
          </button>
          <div className="filter-checkbox-list">
            {values.length === 0 && <p className="filter-empty-hint">No values</p>}
            {values.map((value) => (
              <label key={value} className="filter-checkbox-row">
                <input
                  type="checkbox"
                  aria-label={value}
                  checked={selected.includes(value)}
                  onChange={() => toggleValue(value)}
                />
                <span>{value}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="dialog-error">
          {error}
        </p>
      )}

      <div className="dialog-actions">
        <button type="button" onClick={() => void apply()} disabled={busy}>
          Apply
        </button>
        <button type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

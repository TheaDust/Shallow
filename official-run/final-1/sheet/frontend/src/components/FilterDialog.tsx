import { useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { Dialog } from "../ui/Dialog";
import { FormField, fieldDescriptionIds } from "../ui/FormField";
import { CONDITION_OPTIONS, NO_CONDITION, conditionNeedsValue } from "../domain/filter";
import type { FilterColumn, FilterConditionName } from "../domain/types";

export interface FilterDialogProps {
  open: boolean;
  /** Absolute 1-based column of the header inside the filtered range. */
  column: number;
  /** Header text: the dialog is named `Filter <header text>`. */
  header: string;
  /** Distinct source values of that column, shown as checkboxes. */
  values: string[];
  /** Rule already configured for the column; prefills the form. */
  rule: FilterColumn | null;
  onOpenChange(open: boolean): void;
  /** Persist the column rule; a rejected save keeps the dialog open. */
  onApply(rule: FilterColumn): Promise<void>;
}

const CONDITION_FIELD_ID = "filter-condition";
const VALUE_FIELD_ID = "filter-value";

/**
 * Dialog for one filtered column. It supports both ways of restricting a
 * column — picking specific source values with checkboxes, or a single
 * condition from the "Condition" combo box — and always ends with "Apply".
 */
export function FilterDialog({ open, column, header, values, rule, onOpenChange, onApply }: FilterDialogProps) {
  const [checked, setChecked] = useState<string[]>([]);
  const [condition, setCondition] = useState<string>(NO_CONDITION);
  const [conditionValue, setConditionValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(open);

  // Prefill from the column's saved rule during render, so the first painted
  // frame of the dialog already shows the stored selection.
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setChecked(rule?.mode === "values" && Array.isArray(rule.values) ? [...rule.values] : []);
    setCondition(rule?.mode === "condition" ? rule.condition ?? NO_CONDITION : NO_CONDITION);
    setConditionValue(rule?.mode === "condition" ? rule.value ?? "" : "");
    setError(null);
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const toggle = (value: string, selected: boolean) => {
    setChecked((current) =>
      selected ? [...current.filter((entry) => entry !== value), value] : current.filter((entry) => entry !== value),
    );
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (condition === NO_CONDITION) {
      void apply({ column, header, mode: "values", values: [...checked] });
      return;
    }
    const needsValue = conditionNeedsValue(condition);
    if (needsValue && conditionValue.trim() === "") {
      setError("Please enter a value for the condition");
      return;
    }
    void apply({
      column,
      header,
      mode: "condition",
      condition: condition as FilterConditionName,
      value: needsValue ? conditionValue : "",
    });
  };

  const apply = async (next: FilterColumn) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onApply(next);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to apply the filter");
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title={`Filter ${header}`} onOpenChange={onOpenChange}>
      <form className="filter-dialog" onSubmit={submit}>
        <div className="filter-dialog__values">
          {values.map((value) => (
            <label key={value} className="filter-dialog__value">
              <input
                type="checkbox"
                checked={checked.includes(value)}
                disabled={busy}
                onChange={(event) => toggle(value, event.target.checked)}
              />
              <span>{value}</span>
            </label>
          ))}
        </div>
        <Button type="button" disabled={busy} onClick={() => setChecked([])}>
          Clear selection
        </Button>
        <Combobox
          id={CONDITION_FIELD_ID}
          label="Condition"
          options={CONDITION_OPTIONS}
          value={condition}
          disabled={busy}
          onChange={(event) => setCondition(event.target.value)}
        />
        <FormField id={VALUE_FIELD_ID} label="Value">
          <input
            id={VALUE_FIELD_ID}
            type="text"
            value={conditionValue}
            disabled={busy}
            aria-describedby={fieldDescriptionIds(VALUE_FIELD_ID, { error: Boolean(error) })}
            onChange={(event) => setConditionValue(event.target.value)}
          />
        </FormField>
        {error ? (
          <p className="filter-dialog__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="filter-dialog__actions">
          <Button type="submit" variant="primary" disabled={busy}>
            Apply
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

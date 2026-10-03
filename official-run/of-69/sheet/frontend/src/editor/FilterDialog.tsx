import { useState } from "react";

import { Button, Combobox, Dialog, FormField } from "../ui";
import { FILTER_CONDITION_LABELS } from "../domain/filter";
import type { FilterCondition, FilterRule } from "../domain/types";

/** Submitted choice of one column header's filter dialog; `null` clears that column. */
export type FilterChoice =
  | { mode: "values"; values: string[] }
  | { mode: "condition"; condition: FilterCondition; value: string }
  | null;

export interface FilterDialogProps {
  /** Header text of the filtered column; the dialog is named `Filter <header text>`. */
  headerText: string;
  /** Distinct source values of the column, in source order. */
  values: string[];
  /** Existing rule of this column, used to prefill the controls. */
  rule: FilterRule | null;
  error?: string;
  onApply(choice: FilterChoice): void;
  onOpenChange(open: boolean): void;
}

/**
 * Value/condition dialog of one filtered column (REQ-5-1-2). Checkboxes mirror the
 * distinct source values; the "Condition" combo box narrows the column by a condition.
 * Unchecking every value hides the whole column's rows; selecting all values with no
 * condition removes the column's rule again.
 */
export function FilterDialog({
  headerText,
  values,
  rule,
  error,
  onApply,
  onOpenChange,
}: FilterDialogProps) {
  const [options] = useState<string[]>(() => {
    const selected = rule?.mode === "values" ? rule.values ?? [] : [];
    return [...values, ...selected.filter((value) => !values.includes(value))];
  });
  const [selected, setSelected] = useState<string[]>(
    rule?.mode === "values" ? [...(rule.values ?? [])] : [...values],
  );
  const [condition, setCondition] = useState<string>(
    rule?.mode === "condition" ? rule.condition ?? "" : "",
  );
  const [value, setValue] = useState<string>(rule?.mode === "condition" ? rule.value ?? "" : "");

  function toggle(option: string, checked: boolean) {
    setSelected((current) =>
      checked ? [...current.filter((item) => item !== option), option] : current.filter((item) => item !== option),
    );
  }

  function apply() {
    if (condition !== "") {
      onApply({ mode: "condition", condition: condition as FilterCondition, value });
      return;
    }
    const unchanged = options.length === selected.length && options.every((option) => selected.includes(option));
    onApply(unchanged ? null : { mode: "values", values: options.filter((option) => selected.includes(option)) });
  }

  return (
    <Dialog
      open
      title={`Filter ${headerText}`}
      onOpenChange={onOpenChange}
      actions={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={apply}>
            Apply
          </Button>
        </>
      }
    >
      <p className="ui-dialog__description">
        Show rows whose value matches the checked values or the condition.
      </p>
      <div className="filter-dialog__section">
        <Button onClick={() => setSelected([])}>Clear selection</Button>
        <ul className="filter-dialog__values">
          {options.map((option) => (
            <li key={option}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={(event) => toggle(option, event.target.checked)}
                />
                {option}
              </label>
            </li>
          ))}
        </ul>
      </div>
      <div className="filter-dialog__section">
        <Combobox
          id={`filter-condition-${headerText}`}
          label="Condition"
          value={condition}
          onChange={(event) => setCondition(event.target.value)}
          options={[
            { value: "", label: "No condition" },
            ...FILTER_CONDITION_LABELS.map((entry) => ({ value: entry.value, label: entry.label })),
          ]}
        />
        <FormField id={`filter-value-${headerText}`} label="Value">
          <input
            id={`filter-value-${headerText}`}
            type="text"
            value={value}
            autoComplete="off"
            onChange={(event) => setValue(event.target.value)}
          />
        </FormField>
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </Dialog>
  );
}

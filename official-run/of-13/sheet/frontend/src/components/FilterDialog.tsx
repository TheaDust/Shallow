import { useState } from "react";

import { CONDITION_OPTIONS, conditionNeedsValue } from "../domain/filter";
import type { ColumnFilter, FilterCondition } from "../domain/workbook";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";

export interface FilterDraft {
  /** `values` keeps the checked source values visible, `condition` uses the condition below. */
  mode: "values" | "condition";
  /** Checked source values; only used in `values` mode. */
  values: string[];
  condition: FilterCondition;
  /** Operand of the condition; unused by `Is empty` and `Is not empty`. */
  value: string;
}

export interface FilterDialogProps {
  /** Header text of the column, which is also the dialog's accessible name. */
  headerText: string;
  /** Distinct displayed values of the column, in order of first appearance. */
  values: readonly string[];
  /** Stored filter of this column when it already has one. */
  current?: ColumnFilter;
  busy?: boolean;
  error?: string;
  onApply(draft: FilterDraft): void;
  onClose(): void;
}

/**
 * Value/condition dialog of one filtered column (REQ-5-1-2). It is named `Filter <header text>`
 * and offers both ways of filtering the column: checkboxes named after the source values with
 * `Clear selection`, and a `Condition` combo box with a `Value` text box for the value
 * conditions. Applying a condition ignores the checkboxes and the other way round, so the file
 * button never hides one of the two options.
 */
export function FilterDialog({
  headerText,
  values,
  current,
  busy = false,
  error = "",
  onApply,
  onClose,
}: FilterDialogProps) {
  const startsAsCondition = current?.mode === "condition";
  const [checked, setChecked] = useState<string[]>(() =>
    startsAsCondition ? [...values] : (current?.values ?? [...values]),
  );
  const [condition, setCondition] = useState<FilterCondition | "none">(
    startsAsCondition ? (current?.condition ?? "none") : "none",
  );
  const [value, setValue] = useState(startsAsCondition ? (current?.value ?? "") : "");
  function toggle(source: string) {
    setChecked((previous) =>
      previous.includes(source)
        ? previous.filter((entry) => entry !== source)
        : [...previous, source],
    );
  }

  return (
    <Dialog
      open
      title={`Filter ${headerText}`}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      actions={
        <>
          <Button disabled={busy} onClick={() => setChecked([])}>
            Clear selection
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() =>
              onApply(
                condition === "none"
                  ? {
                      mode: "values",
                      values: values.filter((source) => checked.includes(source)),
                      condition: "text-contains",
                      value: "",
                    }
                  : { mode: "condition", values: [], condition, value },
              )
            }
          >
            Apply
          </Button>
        </>
      }
    >
      <fieldset className="filter-dialog__values">
        <legend>Values</legend>
        {values.length === 0 ? (
          <p>The column has no values to filter.</p>
        ) : (
          values.map((source) => (
            <label key={source} className="filter-dialog__value">
              <input
                type="checkbox"
                checked={checked.includes(source)}
                disabled={busy}
                onChange={() => toggle(source)}
              />
              {source}
            </label>
          ))
        )}
      </fieldset>
      <Combobox
        label="Condition"
        value={condition}
        disabled={busy}
        options={CONDITION_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
        onChange={(event) => setCondition(event.target.value as FilterCondition | "none")}
      />
      <FormField id="filter-value" label="Value">
        <input
          id="filter-value"
          name="filter-value"
          type="text"
          value={value}
          disabled={busy || !conditionNeedsValue(condition)}
          onChange={(event) => setValue(event.target.value)}
        />
      </FormField>
      {error ? (
        <p role="alert" className="page-error">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

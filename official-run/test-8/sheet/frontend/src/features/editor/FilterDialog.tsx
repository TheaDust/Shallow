import { useState, type FormEvent } from "react";

import { Button } from "../../ui/Button";
import { Combobox } from "../../ui/Combobox";
import { Dialog } from "../../ui/Dialog";
import { FormField } from "../../ui/FormField";
import { CONDITION_OPTIONS } from "../../domain/filter";
import { errorMessage } from "../../lib/workbooks-api";
import type { FilterColumn, FilterConditionOperator } from "../../domain/types";

export interface FilterDialogProps {
  /** Column the dialog constrains. */
  col: number;
  /** Header text of that column; the dialog is named `Filter <header>`. */
  header: string;
  /** Distinct source values of the column, used for the value checkboxes. */
  values: string[];
  /** Stored filter of the column, used to prefill the dialog. */
  initial: FilterColumn | null;
  onClose(): void;
  onApply(column: FilterColumn): Promise<unknown>;
}

/**
 * Filter dialog of one column. It offers the value checkboxes (with
 * "Clear selection") and the named conditions of the "Condition" combo box,
 * and applies whichever the user prepared: the selected condition when one is
 * chosen, otherwise the checked source values. Records failing any other
 * column's condition are combined with AND by the store, and nonmatching rows
 * are only hidden — never deleted or reordered.
 */
export function FilterDialog({ col, header, values, initial, onClose, onApply }: FilterDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initial?.kind === "values" ? initial.values : values),
  );
  const [condition, setCondition] = useState<string>(
    initial?.kind === "condition" ? initial.operator : "",
  );
  const [value, setValue] = useState(initial?.kind === "condition" ? initial.value : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (entry: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(entry);
      else next.delete(entry);
      return next;
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const column: FilterColumn = condition
      ? { col, kind: "condition", operator: condition as FilterConditionOperator, value }
      : { col, kind: "values", values: values.filter((entry) => selected.has(entry)) };
    setBusy(true);
    setError(null);
    try {
      await onApply(column);
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title={`Filter ${header}`}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <form className="filter-dialog" onSubmit={submit}>
        <div className="filter-dialog__values">
          <Button type="button" onClick={() => setSelected(new Set())}>Clear selection</Button>
          <div className="filter-dialog__value-list">
            {values.map((entry) => (
              <label key={entry} className="filter-dialog__value">
                <input
                  type="checkbox"
                  checked={selected.has(entry)}
                  onChange={(event) => toggle(entry, event.target.checked)}
                />
                {entry}
              </label>
            ))}
          </div>
        </div>
        <Combobox
          label="Condition"
          value={condition}
          options={CONDITION_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          onChange={(event) => setCondition(event.target.value)}
        />
        <FormField id="filter-value" label="Value">
          <input id="filter-value" value={value} onChange={(event) => setValue(event.target.value)} />
        </FormField>
        {error ? <p className="ui-field__error" role="alert">{error}</p> : null}
        <div className="form-actions">
          <Button type="submit" variant="primary" disabled={busy}>Apply</Button>
        </div>
      </form>
    </Dialog>
  );
}

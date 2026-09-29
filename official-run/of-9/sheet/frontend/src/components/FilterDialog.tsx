import { useEffect, useState } from "react";

import { FILTER_CONDITION_OPTIONS } from "../domain/filter";
import type { ColumnFilter, FilterConditionName } from "../domain/types";
import { Button, Combobox, Dialog, FormField } from "../ui";

export interface FilterDialogProps {
  open: boolean;
  headerText: string;
  column: number;
  values: readonly string[];
  current: ColumnFilter | null;
  busy?: boolean;
  onOpenChange(open: boolean): void;
  onApply(filter: ColumnFilter): void;
}

function allChecked(values: readonly string[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const value of values) map[value] = true;
  return map;
}

/**
 * The "Filter <header text>" dialog. The value section lists every distinct
 * source value as a checkbox ("Clear selection" empties the selection) and
 * applies the checked values; the condition section offers the named
 * conditions with a "Condition" combo box and a "Value" text box.
 */
export function FilterDialog({
  open,
  headerText,
  column,
  values,
  current,
  busy,
  onOpenChange,
  onApply,
}: FilterDialogProps) {
  const [checked, setChecked] = useState<Record<string, boolean>>(() => allChecked(values));
  const [condition, setCondition] = useState<FilterConditionName>("text-contains");
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!open) return;
    if (current?.mode === "values") {
      const selected = new Set(current.values ?? []);
      const map: Record<string, boolean> = {};
      for (const item of values) map[item] = selected.has(item);
      setChecked(map);
    } else {
      setChecked(allChecked(values));
    }
    setCondition(current?.mode === "condition" ? (current.condition ?? "text-contains") : "text-contains");
    setValue(current?.mode === "condition" ? (current.value ?? "") : "");
  }, [open, current, values]);

  const valueDisabled = condition === "is-empty" || condition === "is-not-empty";

  const applyValues = () => {
    onApply({ column, mode: "values", values: values.filter((item) => checked[item]) });
  };

  const applyCondition = () => {
    onApply({ column, mode: "condition", condition, ...(valueDisabled ? {} : { value }) });
  };

  return (
    <Dialog open={open} title={`Filter ${headerText}`} onOpenChange={onOpenChange}>
      <fieldset className="filter-dialog__section">
        <legend>Filter by values</legend>
        <div className="filter-dialog__toolbar">
          <Button variant="ghost" onClick={() => setChecked({})}>
            Clear selection
          </Button>
        </div>
        <div className="filter-dialog__values">
          {values.map((item) => (
            <label key={item === "" ? "(blank)" : item} className="filter-dialog__value">
              <input
                type="checkbox"
                checked={checked[item] ?? false}
                onChange={(event) => setChecked({ ...checked, [item]: event.target.checked })}
              />
              <span>{item === "" ? "(Blanks)" : item}</span>
            </label>
          ))}
          {values.length === 0 ? <p className="filter-dialog__empty">No values</p> : null}
        </div>
        <div className="filter-dialog__actions">
          <Button disabled={busy} onClick={applyValues}>
            Apply
          </Button>
        </div>
      </fieldset>
      <fieldset className="filter-dialog__section">
        <legend>Filter by condition</legend>
        <div className="filter-dialog__condition">
          <Combobox
            label="Condition"
            options={FILTER_CONDITION_OPTIONS}
            value={condition}
            onChange={(event) => setCondition(event.target.value as FilterConditionName)}
          />
          <FormField id="filter-dialog-value" label="Value">
            <input
              id="filter-dialog-value"
              type="text"
              value={value}
              disabled={valueDisabled}
              onChange={(event) => setValue(event.target.value)}
            />
          </FormField>
        </div>
        <div className="filter-dialog__actions">
          <Button disabled={busy} onClick={applyCondition}>
            Apply
          </Button>
        </div>
      </fieldset>
    </Dialog>
  );
}

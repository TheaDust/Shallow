import { useState } from "react";

import { FILTER_CONDITIONS, VALUE_CONDITIONS } from "../domain/filter";
import type { FilterCondition, FilterRule } from "../domain/workbook";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";

const CONDITION_FIELD_ID = "filter-condition";
const VALUE_FIELD_ID = "filter-value";
const NONE = "";

export interface FilterDialogProps {
  /** Header text of the column; the dialog title is `Filter <header>`. */
  header: string;
  /** Distinct displayed source values of the column, in source order. */
  values: readonly string[];
  /** Rule already stored for this column, when the dialog is reopened. */
  rule?: FilterRule | null;
  busy?: boolean;
  /** `null` applies "no constraint of this column" (every value passes). */
  onApply(rule: FilterRule | null): void;
  onOpenChange(open: boolean): void;
}

/**
 * Value/condition filter dialog of one column (REQ-5-1-2), named after the
 * header it filters.
 *
 * One dialog carries both modes: the checkbox list (with `Clear selection`)
 * keeps the rows whose displayed value is selected, while the `Condition` combo
 * box with the comparison `Value` keeps the rows matching a condition such as
 * `Text contains`, `Greater than`, `Before`, `Is empty` or `Is not empty`.
 * Choosing a condition wins; otherwise the checkbox selection is applied, and
 * selecting every value means the column constrains nothing.
 */
export function FilterDialog({
  header,
  values,
  rule = null,
  busy = false,
  onApply,
  onOpenChange,
}: FilterDialogProps) {
  const initialCondition = rule?.type === "condition" ? rule.condition ?? NONE : NONE;
  const [condition, setCondition] = useState<FilterCondition | "">(initialCondition);
  const [value, setValue] = useState(rule?.type === "condition" ? rule.value ?? "" : "");
  const [checked, setChecked] = useState<Set<string>>(() => new Set(
    rule?.type === "values" ? (rule.values ?? []) : values,
  ));

  const toggle = (source: string) => {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  };

  const apply = () => {
    if (busy) return;
    if (condition) {
      const compares = VALUE_CONDITIONS.includes(condition);
      onApply({
        header,
        type: "condition",
        condition,
        ...(compares ? { value } : {}),
      });
      return;
    }
    const selected = values.filter((source) => checked.has(source));
    // Every source value selected means "no constraint of this column"; an
    // empty selection hides every data row of the region (a valid filter).
    onApply(selected.length === values.length ? null : { header, type: "values", values: selected });
  };

  return (
    <Dialog
      open
      title={`Filter ${header}`}
      closeLabel={`Close Filter ${header} dialog`}
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
      actions={<Button variant="primary" disabled={busy} onClick={apply}>Apply</Button>}
    >
      <div className="filter-dialog">
        {/* The checkbox list is a container, not a named group: a name such as
            "Values" would shadow the `Value` text box of the condition controls. */}
        <div className="filter-dialog__values">
          <Button disabled={busy || checked.size === 0} onClick={() => setChecked(new Set())}>
            Clear selection
          </Button>
          <ul className="filter-dialog__list">
            {values.map((source) => (
              <li key={source}>
                <label className="filter-dialog__value">
                  <input
                    type="checkbox"
                    checked={checked.has(source)}
                    disabled={busy}
                    onChange={() => toggle(source)}
                  />
                  {source}
                </label>
              </li>
            ))}
          </ul>
        </div>
        <Combobox
          id={CONDITION_FIELD_ID}
          label="Condition"
          value={condition}
          disabled={busy}
          onChange={(event) => {
            setCondition(event.target.value as FilterCondition | "");
          }}
          options={[
            { value: NONE, label: "None" },
            ...FILTER_CONDITIONS.map((entry) => ({ value: entry.value, label: entry.label })),
          ]}
        />
        <FormField id={VALUE_FIELD_ID} label="Value">
          <input
            id={VALUE_FIELD_ID}
            name="filter-value"
            type="text"
            value={value}
            disabled={busy}
            onChange={(event) => setValue(event.target.value)}
          />
        </FormField>
      </div>
    </Dialog>
  );
}

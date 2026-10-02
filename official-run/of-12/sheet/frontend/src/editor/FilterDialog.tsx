import { useId, useState } from "react";

import {
  FILTER_OPERATORS,
  OPERATOR_LABELS,
  type ColumnCondition,
  type FilterOperator,
} from "../lib/filter-view";
import { Button, Combobox, Dialog } from "../ui";

/** Label of the `Condition` option that selects the value list instead of a condition. */
export const NO_CONDITION_LABEL = "None";

export interface FilterDialogProps {
  /** Column letter the dialog edits. */
  column: string;
  /** Header text of the filtered column; the dialog and its entry button share this name. */
  header: string;
  /** Distinct source values of the column, in the order the records show them. */
  values: readonly string[];
  /** Value list or condition currently applied to this column, if any. */
  condition: ColumnCondition | null;
  busy: boolean;
  error?: string | null;
  onApply(condition: ColumnCondition | null): void;
  onClose(): void;
}

/**
 * Value / condition filter dialog of one header (REQ-5-1-2). Applying a value list keeps the rows
 * whose cell is one of the checked values; applying a condition keeps the rows the condition
 * accepts. Both only hide rows: the records are neither deleted nor reordered.
 *
 * The dialog is mounted when it opens, so it always starts from the filter currently applied to the
 * column.
 */
export function FilterDialog({
  column,
  header,
  values,
  condition,
  busy,
  error,
  onApply,
  onClose,
}: FilterDialogProps) {
  const [operator, setOperator] = useState<FilterOperator | "">(
    condition?.kind === "condition" ? condition.operator : "",
  );
  const [value, setValue] = useState(condition?.kind === "condition" ? condition.value : "");
  const [checked, setChecked] = useState<string[]>(() => (condition?.kind === "values"
    ? values.filter((item) => condition.values.includes(item))
    : [...values]));
  const valueFieldId = useId();

  const toggle = (item: string) => {
    setChecked((current) => (current.includes(item)
      ? current.filter((entry) => entry !== item)
      : [...current, item]));
  };

  const apply = () => {
    if (operator === "") {
      onApply({ column, kind: "values", values: values.filter((item) => checked.includes(item)) });
      return;
    }
    onApply({ column, kind: "condition", operator, value });
  };

  return (
    <Dialog
      open
      title={`Filter ${header}`}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      actions={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={apply} disabled={busy}>Apply</Button>
        </>
      )}
    >
      {error ? <p role="alert" className="ui-field__error">{error}</p> : null}
      <Combobox
        label="Condition"
        value={operator}
        disabled={busy}
        onChange={(event) => setOperator(event.target.value as FilterOperator | "")}
        options={[
          { value: "", label: NO_CONDITION_LABEL },
          ...FILTER_OPERATORS.map((item) => ({ value: item, label: OPERATOR_LABELS[item] })),
        ]}
      />
      <div className="ui-field">
        <label htmlFor={valueFieldId}>Value</label>
        <input
          id={valueFieldId}
          type="text"
          value={value}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
      <fieldset className="filter-dialog__values">
        <legend>Values</legend>
        <Button variant="secondary" onClick={() => setChecked([])} disabled={busy}>
          Clear selection
        </Button>
        <ul className="filter-dialog__list">
          {values.map((item) => (
            <li key={item}>
              <label className="filter-dialog__option">
                <input
                  type="checkbox"
                  checked={checked.includes(item)}
                  disabled={busy}
                  onChange={() => toggle(item)}
                />
                {item}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
    </Dialog>
  );
}

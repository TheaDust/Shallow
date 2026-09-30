import { useEffect, useMemo, useState } from "react";

import { regionToRef, type CellRegion } from "../lib/cells";
import { Button, Combobox, Dialog, FormField } from "../ui";
import { requestErrorMessage } from "../workbooks/api";
import type { ColumnFilterData, FilterCondition, WorksheetData } from "../workbooks/types";
import { FILTER_CONDITION_OPTIONS, conditionNeedsValue, distinctColumnValues } from "./filters";

const DEFAULT_CONDITION: FilterCondition = "textContains";

export interface FilterDialogProps {
  open: boolean;
  headerText: string;
  column: number;
  region: CellRegion;
  worksheet: WorksheetData;
  columnFilter: ColumnFilterData | null;
  onOpenChange(open: boolean): void;
  /** Applies the filter of this column; a rejection keeps the dialog open with its message. */
  onApply(next: ColumnFilterData): Promise<void>;
}

/**
 * Filter of one header of the filtered region. The dialog offers the distinct source values with a
 * `Clear selection` command and, for a condition filter, the `Condition` combo box with the `Value`
 * box; a single `Apply` stores the filter of this column.
 */
export function FilterDialog({
  open,
  headerText,
  column,
  region,
  worksheet,
  columnFilter,
  onOpenChange,
  onApply,
}: FilterDialogProps) {
  const title = `Filter ${headerText}`;
  const values = useMemo(() => distinctColumnValues(worksheet, region, column), [worksheet, region, column]);
  const [checked, setChecked] = useState<string[]>([]);
  const [condition, setCondition] = useState<FilterCondition>(DEFAULT_CONDITION);
  const [valueText, setValueText] = useState("");
  const [conditionTouched, setConditionTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (columnFilter?.kind === "values") {
      setChecked(columnFilter.selected);
      setCondition(DEFAULT_CONDITION);
      setValueText("");
      setConditionTouched(false);
    } else if (columnFilter?.kind === "condition") {
      setChecked(values);
      setCondition(columnFilter.condition);
      setValueText(columnFilter.value);
      setConditionTouched(columnFilter.condition !== DEFAULT_CONDITION);
    } else {
      setChecked(values);
      setCondition(DEFAULT_CONDITION);
      setValueText("");
      setConditionTouched(false);
    }
    setError(null);
    setSubmitting(false);
  }, [open, columnFilter, values]);

  const conditionActive = conditionTouched || valueText.trim() !== "";

  const toggleValue = (value: string, next: boolean) => {
    setChecked((current) =>
      next ? [...current.filter((entry) => entry !== value), value] : current.filter((entry) => entry !== value),
    );
  };

  const apply = async () => {
    setError(null);
    let next: ColumnFilterData;
    if (conditionActive) {
      if (conditionNeedsValue(condition) && valueText.trim() === "") {
        setError("Enter a value for the condition");
        return;
      }
      next = {
        column,
        kind: "condition",
        condition,
        value: conditionNeedsValue(condition) ? valueText.trim() : "",
      };
    } else {
      next = { column, kind: "values", selected: values.filter((value) => checked.includes(value)) };
    }
    setSubmitting(true);
    try {
      await onApply(next);
    } catch (applyError) {
      setError(requestErrorMessage(applyError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={title}
      onOpenChange={onOpenChange}
      actions={
        <Button variant="primary" onClick={() => void apply()} disabled={submitting}>
          Apply
        </Button>
      }
    >
      <p className="filter-dialog__region">Range: {regionToRef(region)}</p>
      <section className="filter-dialog__section" aria-label="Filter by values">
        <div className="filter-dialog__values-header">
          <h3 className="filter-dialog__heading">Values</h3>
          <Button variant="ghost" onClick={() => setChecked([])}>
            Clear selection
          </Button>
        </div>
        <ul className="filter-dialog__values">
          {values.map((value) => (
            <li key={value}>
              <label className="filter-dialog__value">
                <input
                  type="checkbox"
                  checked={checked.includes(value)}
                  onChange={(event) => toggleValue(value, event.target.checked)}
                />
                {value}
              </label>
            </li>
          ))}
        </ul>
      </section>
      <section className="filter-dialog__section" aria-label="Filter by condition">
        <h3 className="filter-dialog__heading">Condition</h3>
        <Combobox
          label="Condition"
          value={condition}
          options={FILTER_CONDITION_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
          onChange={(event) => {
            setCondition(event.target.value as FilterCondition);
            setConditionTouched(true);
          }}
        />
        <FormField id="filter-condition-value" label="Value">
          <input
            id="filter-condition-value"
            type="text"
            value={valueText}
            onChange={(event) => setValueText(event.target.value)}
          />
        </FormField>
      </section>
      {error ? (
        <p className="filter-dialog__error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

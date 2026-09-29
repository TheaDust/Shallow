import { useEffect, useMemo, useState } from "react";

import { Button, Combobox, Dialog, FormField } from "../../ui";
import { errorMessage, setFilter } from "./api";
import {
  FILTER_CONDITION,
  FILTER_OPERATORS,
  FILTER_VALUES,
  distinctValues,
  filterColumnEntry,
  filterButtonLabel,
  operatorById,
  withColumnEntry,
} from "./filtering";
import type { FilterColumn, WorkbookData, WorksheetData, WorksheetFilter } from "./types";

export interface FilterDialogProps {
  workbookId: string;
  worksheet: WorksheetData;
  filter: WorksheetFilter;
  /** Column letter the header button belongs to. */
  column: string;
  /** Visible header text of that column, used as the dialog name. */
  headerText: string;
  onSaved(workbook: WorkbookData): void;
  onClose(): void;
}

/**
 * Dialog named after one header ("Filter <header text>"). It offers the value
 * filter (checkboxes built from the distinct source values plus "Clear
 * selection") and the condition filter (a "Condition" combo box and a "Value"
 * text box). "Apply" stores the column entry of the worksheet filter, which
 * only hides the nonmatching rows of the filtered range.
 */
export function FilterDialog({
  workbookId,
  worksheet,
  filter,
  column,
  headerText,
  onSaved,
  onClose,
}: FilterDialogProps) {
  const distinct = useMemo(
    () => distinctValues(worksheet, filter.range, column),
    [column, filter.range, worksheet],
  );
  const existing = filterColumnEntry(filter, column);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(
    existing?.kind === FILTER_VALUES ? existing.values : distinct,
  ));
  const [operator, setOperator] = useState(
    existing?.kind === FILTER_CONDITION ? existing.operator : FILTER_OPERATORS[0].id,
  );
  const [value, setValue] = useState(existing?.kind === FILTER_CONDITION ? existing.value : "");
  /** Only a condition the user picked replaces the value selection. */
  const [conditionTouched, setConditionTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reopening the dialog for another column starts from that column's state.
  useEffect(() => {
    setSelected(new Set(existing?.kind === FILTER_VALUES ? existing.values : distinct));
    setOperator(existing?.kind === FILTER_CONDITION ? existing.operator : FILTER_OPERATORS[0].id);
    setValue(existing?.kind === FILTER_CONDITION ? existing.value : "");
    setConditionTouched(false);
    setBusy(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [column]);

  const toggleValue = (candidate: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(candidate);
      else next.delete(candidate);
      return next;
    });
  };

  const apply = async () => {
    if (busy) return;
    const chosen = operatorById(operator);
    const usesCondition = conditionTouched && (!chosen.needsValue || value.trim() !== "");
    let entry: FilterColumn | null;
    if (usesCondition) {
      entry = { kind: FILTER_CONDITION, operator: chosen.id, value: chosen.needsValue ? value.trim() : "" };
    } else {
      const kept = distinct.filter((candidate) => selected.has(candidate));
      entry = kept.length === distinct.length ? null : { kind: FILTER_VALUES, values: kept };
    }
    setBusy(true);
    setError(null);
    try {
      const result = await setFilter(workbookId, worksheet.id, withColumnEntry(filter, column, entry));
      onSaved(result.workbook);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title={filterButtonLabel(headerText)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      actions={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void apply()} disabled={busy}>Apply</Button>
        </>
      )}
    >
      <div className="filter-dialog">
        <section className="filter-dialog__values">
          <div className="filter-dialog__head">
            <h3>Values</h3>
            <Button onClick={() => setSelected(new Set())} disabled={busy}>Clear selection</Button>
          </div>
          <div className="filter-dialog__list">
            {distinct.length === 0 ? (
              <p className="filter-dialog__empty">No values in this column.</p>
            ) : distinct.map((candidate) => (
              <label key={candidate} className="filter-dialog__option">
                <input
                  type="checkbox"
                  checked={selected.has(candidate)}
                  aria-label={candidate}
                  disabled={busy}
                  onChange={(event) => toggleValue(candidate, event.target.checked)}
                />
                <span>{candidate}</span>
              </label>
            ))}
          </div>
        </section>
        <section className="filter-dialog__condition">
          <h3>Condition</h3>
          <Combobox
            label="Condition"
            value={operator}
            disabled={busy}
            options={FILTER_OPERATORS.map((candidate) => ({ value: candidate.id, label: candidate.label }))}
            onChange={(event) => {
              setOperator(event.target.value);
              setConditionTouched(true);
            }}
          />
          <FormField id={`filter-value-${column}`} label="Value">
            <input
              id={`filter-value-${column}`}
              type="text"
              value={value}
              disabled={busy || !operatorById(operator).needsValue}
              onChange={(event) => {
                setValue(event.target.value);
                setConditionTouched(true);
              }}
            />
          </FormField>
        </section>
        {error ? <p role="alert" className="form-error">{error}</p> : null}
      </div>
    </Dialog>
  );
}

import { useState } from "react";

import { Button } from "../ui/Button";
import { Combobox, type ComboboxOption } from "../ui/Combobox";
import { NO_COLUMN_FIELD, NO_COLUMN_FIELD_LABEL, SUMMARIZE_OPTIONS, pivotConfigOf } from "../domain/pivot";
import type { PivotConfig, WorksheetPivot } from "../domain/types";

export interface PivotTableEditorProps {
  /** Stored layout of the pivot worksheet currently shown. */
  pivot: WorksheetPivot;
  /** Header texts of the source range: the options of the three field combo boxes. */
  fieldOptions: string[];
  /** Visible error when a configured field is no longer a source header. */
  fieldError: string | null;
  onApply(config: PivotConfig): Promise<void>;
  onRefresh(): Promise<void>;
}

const ROWS_FIELD_ID = "pivot-rows";
const COLUMNS_FIELD_ID = "pivot-columns";
const VALUES_FIELD_ID = "pivot-values";
const SUMMARIZE_FIELD_ID = "pivot-summarize-by";

/**
 * Field layout of one pivot worksheet. The combo boxes offer the current source
 * headers (a field that disappeared stays selectable so its value is visible),
 * "Apply" recomputes the summary and "Refresh pivot table" recomputes it again
 * from the current source data. Both only change the result worksheet.
 */
export function PivotTableEditor({
  pivot,
  fieldOptions,
  fieldError,
  onApply,
  onRefresh,
}: PivotTableEditorProps) {
  const [draft, setDraft] = useState<PivotConfig>(() => pivotConfigOf(pivot));
  const [seen, setSeen] = useState<WorksheetPivot>(pivot);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-sync the form with the stored layout whenever another apply, refresh or
  // workbook load replaces this pivot worksheet.
  if (seen !== pivot) {
    setSeen(pivot);
    setDraft(pivotConfigOf(pivot));
    setError(null);
    setBusy(false);
  }

  /** Header options for one field, keeping a value that is no longer a header. */
  const fieldChoices = (current: string): ComboboxOption[] => {
    const options = fieldOptions.map((header) => ({ value: header, label: header }));
    if (current !== NO_COLUMN_FIELD && !fieldOptions.includes(current)) {
      options.unshift({ value: current, label: current });
    }
    return options;
  };

  const run = async (action: () => Promise<void>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      setBusy(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
      setBusy(false);
    }
  };

  return (
    <section className="pivot-editor" aria-label="Pivot table editor">
      <div className="pivot-editor__fields">
        <Combobox
          id={ROWS_FIELD_ID}
          label="Rows"
          options={fieldChoices(draft.rowField)}
          value={draft.rowField}
          disabled={busy}
          onChange={(event) => setDraft((current) => ({ ...current, rowField: event.target.value }))}
        />
        <Combobox
          id={COLUMNS_FIELD_ID}
          label="Columns"
          options={[
            { value: NO_COLUMN_FIELD, label: NO_COLUMN_FIELD_LABEL },
            ...fieldChoices(draft.columnField),
          ]}
          value={draft.columnField}
          disabled={busy}
          onChange={(event) => setDraft((current) => ({ ...current, columnField: event.target.value }))}
        />
        <Combobox
          id={VALUES_FIELD_ID}
          label="Values"
          options={fieldChoices(draft.valueField)}
          value={draft.valueField}
          disabled={busy}
          onChange={(event) => setDraft((current) => ({ ...current, valueField: event.target.value }))}
        />
        <Combobox
          id={SUMMARIZE_FIELD_ID}
          label="Summarize by"
          options={[...SUMMARIZE_OPTIONS]}
          value={draft.summarizeBy}
          disabled={busy}
          onChange={(event) =>
            setDraft((current) => ({ ...current, summarizeBy: event.target.value as PivotConfig["summarizeBy"] }))
          }
        />
      </div>
      <div className="pivot-editor__actions">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => void run(() => onApply(draft), "Unable to apply the pivot table")}
        >
          Apply
        </Button>
        <Button disabled={busy} onClick={() => void run(() => onRefresh(), "Unable to refresh the pivot table")}>
          Refresh pivot table
        </Button>
      </div>
      {error ?? fieldError ? (
        <p className="pivot-editor__error" role="alert">
          {error ?? fieldError}
        </p>
      ) : null}
    </section>
  );
}

import { useEffect, useMemo, useState } from "react";

import { Button } from "../../ui/Button";
import { Combobox } from "../../ui/Combobox";
import {
  PIVOT_FIELD_MISSING,
  PIVOT_NO_COLUMN_FIELD,
  PIVOT_NO_COLUMN_LABEL,
  PIVOT_SUMMARIZE_OPTIONS,
  pivotFieldOptions,
} from "../../domain/pivot";
import { errorMessage } from "../../lib/workbooks-api";
import type { PivotSummarizeMethod, PivotTable, Worksheet } from "../../domain/types";

/** Field configuration sent to the store when the user applies the pivot. */
export interface PivotFieldSelection {
  rowField: string;
  columnField: string | null;
  valueField: string;
  summarizeBy: PivotSummarizeMethod;
}

export interface PivotTableEditorProps {
  pivot: PivotTable;
  /** Worksheet the pivot reads; its headers name the field options. */
  sourceWorksheet: Worksheet;
  onApply(selection: PivotFieldSelection): Promise<unknown>;
  onRefresh(): Promise<unknown>;
}

/**
 * "Pivot table editor" region shown on a pivot result worksheet. Its "Rows",
 * "Columns", "Values" and "Summarize by" combo boxes configure one row field,
 * one optional column field and one value field; "Apply" recomputes the
 * summary, "Refresh pivot table" rebuilds it from the current source range. A
 * deleted field or an inapplicable value field shows a message and keeps the
 * last successful result.
 */
export function PivotTableEditor({ pivot, sourceWorksheet, onApply, onRefresh }: PivotTableEditorProps) {
  const fields = useMemo(
    () => pivotFieldOptions(sourceWorksheet, pivot.sourceRange),
    [sourceWorksheet, pivot.sourceRange],
  );
  const [rowField, setRowField] = useState(pivot.rowField || fields[0]?.value || "");
  const [columnField, setColumnField] = useState(pivot.columnField ?? PIVOT_NO_COLUMN_FIELD);
  const [valueField, setValueField] = useState(
    pivot.valueField || fields[1]?.value || fields[0]?.value || "",
  );
  const [summarizeBy, setSummarizeBy] = useState<PivotSummarizeMethod>(pivot.summarizeBy);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Opening the editor of a pivot whose stored field disappeared shows the
  // message until the field is reselected.
  useEffect(() => {
    const names = new Set(fields.map((field) => field.value));
    const missing =
      (pivot.rowField !== "" && !names.has(pivot.rowField)) ||
      (pivot.valueField !== "" && !names.has(pivot.valueField)) ||
      (pivot.columnField !== null && !names.has(pivot.columnField));
    if (missing) setError(PIVOT_FIELD_MISSING);
  }, [pivot.id, pivot.rowField, pivot.valueField, pivot.columnField, fields]);

  const run = async (task: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const apply = () =>
    run(() =>
      onApply({
        rowField,
        columnField: columnField === PIVOT_NO_COLUMN_FIELD ? null : columnField,
        valueField,
        summarizeBy,
      }),
    );

  return (
    <section className="pivot-editor" aria-label="Pivot table editor">
      <div className="pivot-editor__fields">
        <Combobox
          label="Rows"
          value={rowField}
          options={fields}
          onChange={(event) => setRowField(event.target.value)}
        />
        <Combobox
          label="Columns"
          value={columnField}
          options={[{ value: PIVOT_NO_COLUMN_FIELD, label: PIVOT_NO_COLUMN_LABEL }, ...fields]}
          onChange={(event) => setColumnField(event.target.value)}
        />
        <Combobox
          label="Values"
          value={valueField}
          options={fields}
          onChange={(event) => setValueField(event.target.value)}
        />
        <Combobox
          label="Summarize by"
          value={summarizeBy}
          options={PIVOT_SUMMARIZE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          onChange={(event) => setSummarizeBy(event.target.value as PivotSummarizeMethod)}
        />
      </div>
      {error ? <p className="ui-field__error" role="alert">{error}</p> : null}
      <div className="form-actions">
        <Button variant="primary" onClick={() => void apply()} disabled={busy}>Apply</Button>
        <Button onClick={() => void run(onRefresh)} disabled={busy}>Refresh pivot table</Button>
      </div>
    </section>
  );
}

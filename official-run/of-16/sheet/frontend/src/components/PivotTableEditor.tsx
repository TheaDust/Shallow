import { useEffect, useState } from "react";

import { defaultPivotFields, SUMMARIZE_METHODS } from "../domain/pivot";
import type { PivotFields, PivotSummarize, PivotTable } from "../domain/workbook";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";

export interface PivotTableEditorProps {
  /** Header texts of the source range; the accessible names of the field options. */
  headers: readonly string[];
  /** Stored configuration of the pivot worksheet currently shown. */
  pivot: PivotTable;
  busy: boolean;
  /** Visible error of the last failed apply/refresh, or an unusable stored field. */
  error?: string | null;
  onApply(fields: PivotFields): void;
  onRefresh(): void;
}

/** Options of a field combo: the source headers, keeping a stale stored field visible. */
function fieldOptions(headers: readonly string[], value: string): { value: string; label: string }[] {
  const names = value && !headers.includes(value) ? [value, ...headers] : [...headers];
  return names.map((name) => ({ value: name, label: name }));
}

/**
 * "Pivot table editor" of the active pivot-result worksheet (REQ-5-3-1).
 *
 * The four combo boxes choose one row field, one optional column field, one
 * value field and the summarization method; `Apply` stores that configuration
 * and recomputes the summary, while `Refresh pivot table` recomputes from the
 * stored configuration after the source data changed. Options carry the source
 * header text as their accessible name, and the selected field of a deleted
 * header stays visible so it can be replaced instead of silently reset.
 */
export function PivotTableEditor({ headers, pivot, busy, error = null, onApply, onRefresh }: PivotTableEditorProps) {
  const defaults = defaultPivotFields(headers);
  const [rowField, setRowField] = useState(pivot.rowField || defaults.rowField);
  const [columnField, setColumnField] = useState(pivot.columnField);
  const [valueField, setValueField] = useState(pivot.valueField || defaults.valueField);
  const [summarizeBy, setSummarizeBy] = useState<PivotSummarize>(pivot.summarizeBy);

  // A successful apply/refresh (or a source change that renames a header) makes
  // the stored configuration authoritative again.
  useEffect(() => {
    setRowField(pivot.rowField || defaultPivotFields(headers).rowField);
    setColumnField(pivot.columnField);
    setValueField(pivot.valueField || defaultPivotFields(headers).valueField);
    setSummarizeBy(pivot.summarizeBy);
  }, [pivot.rowField, pivot.columnField, pivot.valueField, pivot.summarizeBy, headers.join("\u0000")]);

  return (
    <section className="pivot-editor" aria-label="Pivot table editor">
      <Combobox
        id="pivot-rows"
        label="Rows"
        value={rowField}
        disabled={busy}
        options={fieldOptions(headers, rowField)}
        onChange={(event) => setRowField(event.target.value)}
      />
      <Combobox
        id="pivot-columns"
        label="Columns"
        value={columnField}
        disabled={busy}
        options={[{ value: "", label: "None" }, ...fieldOptions(headers, columnField)]}
        onChange={(event) => setColumnField(event.target.value)}
      />
      <Combobox
        id="pivot-values"
        label="Values"
        value={valueField}
        disabled={busy}
        options={fieldOptions(headers, valueField)}
        onChange={(event) => setValueField(event.target.value)}
      />
      <Combobox
        id="pivot-summarize"
        label="Summarize by"
        value={summarizeBy}
        disabled={busy}
        options={SUMMARIZE_METHODS.map((method) => ({ value: method, label: method }))}
        onChange={(event) => setSummarizeBy(event.target.value as PivotSummarize)}
      />
      <div className="pivot-editor__actions">
        <Button variant="primary" disabled={busy} onClick={() => onApply({ rowField, columnField, valueField, summarizeBy })}>
          Apply
        </Button>
        <Button disabled={busy} onClick={onRefresh}>Refresh pivot table</Button>
      </div>
      {error ? <p role="alert" className="pivot-editor__error">{error}</p> : null}
    </section>
  );
}

import { useState } from "react";

import { NO_PIVOT_FIELD, PIVOT_METHODS, pivotFieldOptions } from "../domain/pivot";
import type { PivotConfig, PivotMethod, WorkbookState, WorksheetState } from "../domain/workbook";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";

/** Field selection submitted by `Apply`, independent of the stored source range. */
export interface PivotDraft {
  rowField: string;
  columnField: string;
  valueField: string;
  method: PivotMethod;
}

export interface PivotTableEditorProps {
  workbook: WorkbookState;
  /** The active pivot-result worksheet. */
  sheet: WorksheetState;
  busy?: boolean;
  error?: string;
  onApply(draft: PivotDraft): void;
  onRefresh(): void;
}

/**
 * `Pivot table editor` region of a pivot-result worksheet (REQ-5-3-1): the `Rows`, `Columns`,
 * `Values` and `Summarize by` combo boxes plus `Apply` and `Refresh pivot table`. The `Rows`,
 * `Columns` and `Values` options are the header texts of the source range; `Apply` stores the
 * configuration and its recomputed summary, `Refresh pivot table` recomputes the stored one.
 */
export function PivotTableEditor({
  workbook,
  sheet,
  busy = false,
  error = "",
  onApply,
  onRefresh,
}: PivotTableEditorProps) {
  const pivot = sheet.pivot as PivotConfig;
  const headers = pivotFieldOptions(workbook, pivot);
  const [rowField, setRowField] = useState(pivot.rowField || headers[0] || NO_PIVOT_FIELD);
  const [columnField, setColumnField] = useState(pivot.columnField || NO_PIVOT_FIELD);
  const [valueField, setValueField] = useState(
    pivot.valueField || headers[1] || headers[0] || NO_PIVOT_FIELD,
  );
  const [method, setMethod] = useState<PivotMethod>(pivot.method);

  // A stored field whose header was deleted stays selectable so its value is visible instead of
  // silently disappearing; the next Apply or refresh then reports it as unavailable.
  const fieldOptions = (stored: string, withNone = false): Array<{ value: string; label: string }> => {
    const values = stored !== "" && !headers.includes(stored) ? [...headers, stored] : headers;
    const options = values.map((header) => ({ value: header, label: header }));
    if (withNone) return [{ value: NO_PIVOT_FIELD, label: "None" }, ...options];
    return options.length > 0 ? options : [{ value: NO_PIVOT_FIELD, label: "None" }];
  };

  return (
    <section aria-label="Pivot table editor" className="pivot-editor">
      <Combobox
        label="Rows"
        value={rowField}
        disabled={busy}
        options={fieldOptions(rowField)}
        onChange={(event) => setRowField(event.target.value)}
      />
      <Combobox
        label="Columns"
        value={columnField}
        disabled={busy}
        options={fieldOptions(columnField, true)}
        onChange={(event) => setColumnField(event.target.value)}
      />
      <Combobox
        label="Values"
        value={valueField}
        disabled={busy}
        options={fieldOptions(valueField)}
        onChange={(event) => setValueField(event.target.value)}
      />
      <Combobox
        label="Summarize by"
        value={method}
        disabled={busy}
        options={PIVOT_METHODS.map((entry) => ({ value: entry, label: entry }))}
        onChange={(event) => setMethod(event.target.value as PivotMethod)}
      />
      <div className="pivot-editor__actions">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => onApply({ rowField, columnField, valueField, method })}
        >
          Apply
        </Button>
        <Button disabled={busy} onClick={onRefresh}>
          Refresh pivot table
        </Button>
      </div>
      {error ? (
        <p role="alert" className="page-error pivot-editor__error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

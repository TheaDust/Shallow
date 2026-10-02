import { useState } from "react";

import {
  NO_PIVOT_FIELD,
  NO_PIVOT_FIELD_LABEL,
  PIVOT_FIELDS_REQUIRED_MESSAGE,
  SUMMARIZE_METHODS,
  type PivotConfig,
  type PivotSettings,
  type SummarizeMethod,
} from "../lib/pivot";
import { Button, Combobox } from "../ui";

export interface PivotTableEditorProps {
  /** Stored configuration of the pivot worksheet the editor belongs to. */
  pivot: PivotConfig;
  /** Source headers offered as fields; an option is named by the header text it selects. */
  fields: readonly string[];
  busy: boolean;
  error?: string | null;
  onApply(settings: PivotSettings): void;
  onRefresh(): void;
}

/**
 * `Pivot table editor` region of a pivot-result worksheet (REQ-5-3-1): the row field, the optional
 * column field, the value field and the summarization method, plus `Apply` and
 * `Refresh pivot table`. The region starts from the stored configuration, so it always shows the
 * layout and the method of the result the grid displays.
 */
export function PivotTableEditor({ pivot, fields, busy, error, onApply, onRefresh }: PivotTableEditorProps) {
  const [rows, setRows] = useState(pivot.rows ?? fields[0] ?? "");
  const [columns, setColumns] = useState(pivot.columns ?? NO_PIVOT_FIELD);
  const [values, setValues] = useState(pivot.values ?? fields[1] ?? fields[0] ?? "");
  const [summarizeBy, setSummarizeBy] = useState<SummarizeMethod>(pivot.summarizeBy);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const fieldOptions = fields.map((field) => ({ value: field, label: field }));

  const apply = () => {
    if (!rows || !values) {
      setFieldError(PIVOT_FIELDS_REQUIRED_MESSAGE);
      return;
    }
    setFieldError(null);
    onApply({ rows, columns: columns === NO_PIVOT_FIELD ? null : columns, values, summarizeBy });
  };

  const message = error ?? fieldError;

  return (
    <section className="pivot-editor" aria-label="Pivot table editor">
      <h2 className="pivot-editor__title">Pivot table editor</h2>
      {message ? <p role="alert" className="ui-field__error">{message}</p> : null}
      <div className="pivot-editor__fields">
        <Combobox
          label="Rows"
          value={rows}
          disabled={busy}
          onChange={(event) => setRows(event.target.value)}
          options={fieldOptions}
        />
        <Combobox
          label="Columns"
          value={columns}
          disabled={busy}
          onChange={(event) => setColumns(event.target.value)}
          options={[{ value: NO_PIVOT_FIELD, label: NO_PIVOT_FIELD_LABEL }, ...fieldOptions]}
        />
        <Combobox
          label="Values"
          value={values}
          disabled={busy}
          onChange={(event) => setValues(event.target.value)}
          options={fieldOptions}
        />
        <Combobox
          label="Summarize by"
          value={summarizeBy}
          disabled={busy}
          onChange={(event) => setSummarizeBy(event.target.value as SummarizeMethod)}
          options={SUMMARIZE_METHODS.map((method) => ({ value: method, label: method }))}
        />
      </div>
      <div className="pivot-editor__actions">
        <Button onClick={apply} disabled={busy}>Apply</Button>
        <Button variant="secondary" onClick={onRefresh} disabled={busy}>Refresh pivot table</Button>
      </div>
    </section>
  );
}

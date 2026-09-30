import { useState } from "react";

import { regionToRef } from "../lib/cells";
import { Button, Combobox } from "../ui";
import { requestErrorMessage } from "../workbooks/api";
import type { PivotData, PivotFieldInput, PivotSummary, WorksheetData } from "../workbooks/types";
import {
  MISSING_PIVOT_FIELD_MESSAGE,
  MISSING_PIVOT_SELECTION_MESSAGE,
  MISSING_PIVOT_SOURCE_MESSAGE,
  NO_FIELD_LABEL,
  NO_FIELD_VALUE,
  PIVOT_SUMMARIES,
  missingPivotFields,
  pivotFieldInput,
  pivotFieldsOf,
  pivotHeaders,
  type PivotFieldSelection,
} from "./pivot";

export interface PivotTableEditorProps {
  /** Stored configuration of the pivot result worksheet that is currently active. */
  pivot: PivotData;
  /** Worksheet the pivot reads its source range from, when it still exists. */
  sourceWorksheet: WorksheetData | null;
  /** True while a mutation runs; the commands stay visible but cannot start a second one. */
  busy?: boolean;
  /** Applies the selected fields; a rejection keeps the last successful result and is shown here. */
  onApply(fields: PivotFieldInput): Promise<void>;
  /** Rebuilds the summary from the stored configuration and the current source data. */
  onRefresh(): Promise<void>;
}

/**
 * `Pivot table editor` region of a pivot result worksheet (REQ-5-3-1): the `Rows`, `Columns`,
 * `Values` and `Summarize by` combo boxes whose options are the source header texts, the `Apply`
 * command and the `Refresh pivot table` command. A field whose source header was deleted is reported
 * here while the last successful result stays in the grid.
 */
export function PivotTableEditor({ pivot, sourceWorksheet, busy = false, onApply, onRefresh }: PivotTableEditorProps) {
  const headers = pivotHeaders(sourceWorksheet, pivot.sourceRange);
  const storedKey = [pivot.rows ?? "", pivot.columns ?? "", pivot.values ?? "", pivot.summarizeBy].join("|");
  const [syncedKey, setSyncedKey] = useState(storedKey);
  const [fields, setFields] = useState<PivotFieldSelection>(() => pivotFieldsOf(pivot));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The stored configuration is the truth: it is taken over whenever the server answers with another
  // one (after an apply, a refresh or a reload), while local picks survive a rejected command.
  if (syncedKey !== storedKey) {
    setSyncedKey(storedKey);
    setFields(pivotFieldsOf(pivot));
    setError(null);
  }

  const fieldOptions = [
    { value: NO_FIELD_VALUE, label: NO_FIELD_LABEL },
    ...headers.map((header) => ({ value: header, label: header })),
  ];
  const missing = missingPivotFields(pivot, headers);
  const shownError =
    error ??
    (missing.length > 0
      ? MISSING_PIVOT_FIELD_MESSAGE
      : sourceWorksheet
        ? null
        : MISSING_PIVOT_SOURCE_MESSAGE);

  const change = (patch: Partial<PivotFieldSelection>) => {
    setFields((current) => ({ ...current, ...patch }));
    setError(null);
  };

  const apply = async () => {
    if (fields.rows === NO_FIELD_VALUE || fields.values === NO_FIELD_VALUE) {
      setError(MISSING_PIVOT_SELECTION_MESSAGE);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onApply(pivotFieldInput(fields));
    } catch (applyError) {
      setError(requestErrorMessage(applyError));
    } finally {
      setSubmitting(false);
    }
  };

  const refresh = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await onRefresh();
    } catch (refreshError) {
      setError(requestErrorMessage(refreshError));
    } finally {
      setSubmitting(false);
    }
  };

  const disabled = busy || submitting;

  return (
    <section className="pivot-editor" aria-label="Pivot table editor">
      <h2 className="pivot-editor__heading">Pivot table editor</h2>
      <p className="pivot-editor__source">Source range: {regionToRef(pivot.sourceRange)}</p>
      <div className="pivot-editor__fields">
        <Combobox
          label="Rows"
          value={fields.rows}
          options={fieldOptions}
          onChange={(event) => change({ rows: event.target.value })}
        />
        <Combobox
          label="Columns"
          value={fields.columns}
          options={fieldOptions}
          onChange={(event) => change({ columns: event.target.value })}
        />
        <Combobox
          label="Values"
          value={fields.values}
          options={fieldOptions}
          onChange={(event) => change({ values: event.target.value })}
        />
        <Combobox
          label="Summarize by"
          value={fields.summarizeBy}
          options={PIVOT_SUMMARIES.map((summary) => ({ value: summary, label: summary }))}
          onChange={(event) => change({ summarizeBy: event.target.value as PivotSummary })}
        />
      </div>
      <div className="pivot-editor__actions">
        <Button variant="primary" onClick={() => void apply()} disabled={disabled}>
          Apply
        </Button>
        <Button onClick={() => void refresh()} disabled={disabled}>
          Refresh pivot table
        </Button>
      </div>
      {shownError ? (
        <p className="pivot-editor__error" role="alert">
          {shownError}
        </p>
      ) : null}
    </section>
  );
}

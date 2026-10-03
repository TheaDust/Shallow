import { useState } from "react";

import { ApiError } from "../lib/api";
import {
  PIVOT_FIELD_MISSING_MESSAGE,
  PIVOT_METHODS,
  pivotFieldComboboxOptions,
  pivotSourceWorksheet,
  unavailablePivotFields,
} from "../domain/pivot";
import { applyPivotTable, refreshPivotTable } from "../domain/workbook-api";
import type { PivotMethod, Workbook, Worksheet } from "../domain/types";
import { Button, Combobox } from "../ui";

export const PIVOT_APPLY_ERROR = "Unable to apply the pivot table. Please try again.";
export const PIVOT_REFRESH_ERROR = "Unable to refresh the pivot table. Please try again.";

export interface PivotTableEditorProps {
  workbookId: string;
  workbook: Workbook;
  /** The active pivot-result worksheet holding the summary. */
  worksheet: Worksheet;
  onUpdated(workbook: Workbook): void;
}

/**
 * "Pivot table editor" region of a pivot-result worksheet (REQ-5-3-1): the Rows, Columns,
 * Values and Summarize by combo boxes plus "Apply" and "Refresh pivot table". Applying or
 * refreshing only rewrites this worksheet's summary; a rejected configuration keeps the
 * last successful result and never modifies the source worksheet.
 */
export function PivotTableEditor({ workbookId, workbook, worksheet, onUpdated }: PivotTableEditorProps) {
  const pivot = worksheet.pivot;
  const source = pivotSourceWorksheet(workbook, worksheet);
  const sourceRange = pivot?.sourceRange ?? "";
  const options = pivotFieldComboboxOptions(source, sourceRange, false);
  const missing = unavailablePivotFields(workbook, worksheet);

  const [rowField, setRowField] = useState<string>(pivot?.rowField ?? options[0]?.value ?? "");
  const [columnField, setColumnField] = useState<string>(pivot?.columnField ?? "");
  const [valueField, setValueField] = useState<string>(
    pivot?.valueField ?? options[1]?.value ?? options[0]?.value ?? "",
  );
  const [summarizeBy, setSummarizeBy] = useState<PivotMethod>(pivot?.summarizeBy ?? PIVOT_METHODS[0]);
  const [error, setError] = useState(missing.length > 0 ? PIVOT_FIELD_MISSING_MESSAGE : "");
  const [pending, setPending] = useState(false);

  async function run(operation: () => Promise<Workbook>, fallback: string) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      onUpdated(await operation());
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : fallback);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="pivot-editor" role="region" aria-label="Pivot table editor">
      <div className="pivot-editor__fields">
        <Combobox
          id={`${worksheet.id}-pivot-rows`}
          label="Rows"
          value={rowField}
          onChange={(event) => setRowField(event.target.value)}
          options={options}
        />
        <Combobox
          id={`${worksheet.id}-pivot-columns`}
          label="Columns"
          value={columnField}
          onChange={(event) => setColumnField(event.target.value)}
          options={pivotFieldComboboxOptions(source, sourceRange, true)}
        />
        <Combobox
          id={`${worksheet.id}-pivot-values`}
          label="Values"
          value={valueField}
          onChange={(event) => setValueField(event.target.value)}
          options={options}
        />
        <Combobox
          id={`${worksheet.id}-pivot-summarize`}
          label="Summarize by"
          value={summarizeBy}
          onChange={(event) => setSummarizeBy(event.target.value as PivotMethod)}
          options={PIVOT_METHODS.map((method) => ({ value: method, label: method }))}
        />
      </div>
      <div className="pivot-editor__actions">
        <Button
          variant="primary"
          disabled={pending}
          onClick={() =>
            run(
              () =>
                applyPivotTable(workbookId, worksheet.id, {
                  rowField,
                  columnField: columnField === "" ? null : columnField,
                  valueField,
                  summarizeBy,
                }),
              PIVOT_APPLY_ERROR,
            )
          }
        >
          Apply
        </Button>
        <Button
          disabled={pending}
          onClick={() => run(() => refreshPivotTable(workbookId, worksheet.id), PIVOT_REFRESH_ERROR)}
        >
          Refresh pivot table
        </Button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {pending ? <p role="status">Updating pivot table…</p> : null}
    </section>
  );
}

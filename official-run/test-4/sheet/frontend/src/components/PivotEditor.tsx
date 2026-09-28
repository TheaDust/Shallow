import { useEffect, useState } from "react";

import { cellName, rangeColumns, rangeTopRow } from "../lib/spreadsheet";
import type { PivotConfigPayload, SheetState, Workbook } from "../lib/workbooks";

interface PivotEditorProps {
  workbook: Workbook;
  /** The active pivot-result worksheet. */
  sheet: SheetState;
  onApply: (config: PivotConfigPayload) => Promise<void>;
  onRefresh: () => Promise<void>;
}

const SUMMARIZE_OPTIONS = ["SUM", "COUNT", "AVERAGE"] as const;

/**
 * The "Pivot table editor" region (REQ-5-3-1): combo boxes labeled "Rows",
 * "Columns", "Values" (options named by the current source header texts) and
 * "Summarize by" (SUM/COUNT/AVERAGE), an "Apply" button that recomputes the
 * summary, and a "Refresh pivot table" button that recomputes with the
 * stored configuration. Opening the editor with a deleted selected header
 * shows the field-unavailable error while preserving the last result.
 */
export function PivotEditor({ workbook, sheet, onApply, onRefresh }: PivotEditorProps) {
  const pivot = sheet.pivot;
  const sourceSheet =
    workbook.sheets.find((item) => item.id === pivot?.sourceSheetId) ?? null;

  const headers = (() => {
    if (!pivot || !sourceSheet) return [];
    const headerRow = rangeTopRow(pivot.sourceRange);
    const seen = new Set<string>();
    const result: string[] = [];
    for (const col of rangeColumns(pivot.sourceRange)) {
      const text = (sourceSheet.cells[cellName(headerRow, col)] ?? "").trim();
      if (text !== "" && !seen.has(text)) {
        seen.add(text);
        result.push(text);
      }
    }
    return result;
  })();

  const [rowField, setRowField] = useState<string>(pivot?.rowField ?? "");
  const [columnField, setColumnField] = useState<string>(pivot?.columnField ?? "");
  const [valueField, setValueField] = useState<string>(pivot?.valueField ?? "");
  const [summarizeBy, setSummarizeBy] = useState<string>(pivot?.summarizeBy ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Keep the combo boxes in sync when the persisted configuration changes
  // (Apply response, undo, reopening a configured pivot sheet).
  useEffect(() => {
    setRowField(pivot?.rowField ?? "");
    setColumnField(pivot?.columnField ?? "");
    setValueField(pivot?.valueField ?? "");
    setSummarizeBy(pivot?.summarizeBy ?? "");
  }, [pivot?.rowField, pivot?.columnField, pivot?.valueField, pivot?.summarizeBy]);

  // A selected field whose header no longer exists in the source range:
  // show the visible error and require reselection (REQ-2-2-2/REQ-5-3-1).
  const staleField =
    (pivot?.rowField && !headers.includes(pivot.rowField)) ||
    (pivot?.columnField && !headers.includes(pivot.columnField)) ||
    (pivot?.valueField && !headers.includes(pivot.valueField));
  const shownError = staleField
    ? "Pivot field is no longer available. Select a new field."
    : error;

  const hasConfig = Boolean(pivot && pivot.rowField && pivot.valueField && pivot.summarizeBy);

  async function apply() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onApply({
        rowField,
        columnField: columnField === "" ? null : columnField,
        valueField,
        summarizeBy: summarizeBy as PivotConfigPayload["summarizeBy"],
      });
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : String(applyError));
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onRefresh();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section role="region" aria-label="Pivot table editor" className="pivot-editor">
      <h2 className="pivot-editor-title">Pivot table editor</h2>

      <div className="pivot-fields">
        <div className="dialog-field">
          <label htmlFor="pivot-rows">Rows</label>
          <select
            id="pivot-rows"
            value={rowField}
            onChange={(event) => setRowField(event.target.value)}
            disabled={busy}
          >
            <option value=""></option>
            {headers.map((header) => (
              <option key={header} value={header}>
                {header}
              </option>
            ))}
          </select>
        </div>

        <div className="dialog-field">
          <label htmlFor="pivot-columns">Columns</label>
          <select
            id="pivot-columns"
            value={columnField}
            onChange={(event) => setColumnField(event.target.value)}
            disabled={busy}
          >
            <option value=""></option>
            {headers.map((header) => (
              <option key={header} value={header}>
                {header}
              </option>
            ))}
          </select>
        </div>

        <div className="dialog-field">
          <label htmlFor="pivot-values">Values</label>
          <select
            id="pivot-values"
            value={valueField}
            onChange={(event) => setValueField(event.target.value)}
            disabled={busy}
          >
            <option value=""></option>
            {headers.map((header) => (
              <option key={header} value={header}>
                {header}
              </option>
            ))}
          </select>
        </div>

        <div className="dialog-field">
          <label htmlFor="pivot-summarize-by">Summarize by</label>
          <select
            id="pivot-summarize-by"
            value={summarizeBy}
            onChange={(event) => setSummarizeBy(event.target.value)}
            disabled={busy}
          >
            <option value=""></option>
            {SUMMARIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>

      {shownError && (
        <p role="alert" className="pivot-error">
          {shownError}
        </p>
      )}

      <div className="pivot-actions">
        <button
          type="button"
          className="primary"
          onClick={() => void apply()}
          disabled={busy}
        >
          Apply
        </button>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy || !hasConfig}
        >
          Refresh pivot table
        </button>
      </div>
    </section>
  );
}

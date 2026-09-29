import { useEffect, useState } from "react";

import type { PivotConfig, SummarizeBy } from "../domain/types";
import { Button, Combobox } from "../ui";

export interface PivotEditorProps {
  config: PivotConfig;
  /** Source header texts (options of the Rows/Columns/Values combo boxes). */
  headers: readonly string[];
  busy: boolean;
  error?: string | null;
  onApply(next: { rowField: string; columnField: string | null; valueField: string; summarizeBy: SummarizeBy }): void;
  onRefresh(): void;
}

const NONE_OPTION = { value: "", label: "(None)" };
const SUMMARIZE_OPTIONS: ReadonlyArray<{ value: SummarizeBy; label: SummarizeBy }> = [
  { value: "SUM", label: "SUM" },
  { value: "COUNT", label: "COUNT" },
  { value: "AVERAGE", label: "AVERAGE" },
];

/**
 * The "Pivot table editor" region shown on a pivot-result worksheet: the
 * Rows/Columns/Values/Summarize by combo boxes, Apply, and the explicit
 * "Refresh pivot table" action.
 */
export function PivotEditor({ config, headers, busy, error, onApply, onRefresh }: PivotEditorProps) {
  const [rowField, setRowField] = useState(config.rowField);
  const [columnField, setColumnField] = useState(config.columnField ?? "");
  const [valueField, setValueField] = useState(config.valueField);
  const [summarizeBy, setSummarizeBy] = useState<SummarizeBy>(config.summarizeBy ?? "SUM");

  useEffect(() => {
    setRowField(config.rowField);
    setColumnField(config.columnField ?? "");
    setValueField(config.valueField);
    setSummarizeBy(config.summarizeBy ?? "SUM");
  }, [config]);

  const fieldOptions = [
    NONE_OPTION,
    ...headers.filter((header) => header !== "").map((header) => ({ value: header, label: header })),
  ];

  const apply = () => {
    onApply({
      rowField,
      columnField: columnField === "" ? null : columnField,
      valueField,
      summarizeBy,
    });
  };

  return (
    <section role="region" aria-label="Pivot table editor" className="pivot-editor">
      <h3 className="pivot-editor__title">Pivot table editor</h3>
      <div className="pivot-editor__fields">
        <Combobox
          label="Rows"
          options={fieldOptions}
          value={rowField}
          onChange={(event) => setRowField(event.target.value)}
        />
        <Combobox
          label="Columns"
          options={fieldOptions}
          value={columnField}
          onChange={(event) => setColumnField(event.target.value)}
        />
        <Combobox
          label="Values"
          options={fieldOptions}
          value={valueField}
          onChange={(event) => setValueField(event.target.value)}
        />
        <Combobox
          label="Summarize by"
          options={SUMMARIZE_OPTIONS}
          value={summarizeBy}
          onChange={(event) => setSummarizeBy(event.target.value as SummarizeBy)}
        />
      </div>
      <div className="pivot-editor__actions">
        <Button disabled={busy} onClick={apply}>
          Apply
        </Button>
        <Button disabled={busy} onClick={onRefresh}>
          Refresh pivot table
        </Button>
      </div>
      {error ? (
        <p role="alert" className="pivot-editor__error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

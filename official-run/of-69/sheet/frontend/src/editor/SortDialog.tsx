import { useState } from "react";

import { ApiError } from "../lib/api";
import { sortWorksheetRange } from "../domain/workbook-api";
import { SORT_ORDER_OPTIONS, sortColumnOptions, type SortOrder } from "../domain/sort";
import type { Workbook, Worksheet } from "../domain/types";
import { Button, Combobox, Dialog } from "../ui";

export const SORT_SAVE_ERROR = "Unable to sort the selected range. Please try again.";
export const SORT_COLUMN_REQUIRED_MESSAGE = "Select a column to sort by";

export interface SortDialogProps {
  workbookId: string;
  worksheet: Worksheet;
  /** The selected rectangle the sort applies to. */
  range: string;
  onOpenChange(open: boolean): void;
  onSorted(workbook: Workbook): void;
}

/**
 * "Sort range" dialog (REQ-5-1-1): the sort key column, the order and whether the first
 * row is a header. "Sort by" options are named after the header text of the range; the
 * unchanged range keeps its filter and validation rules. A failed sort keeps the dialog
 * open with an error and the grid keeps its original order.
 */
export function SortDialog({
  workbookId,
  worksheet,
  range,
  onOpenChange,
  onSorted,
}: SortDialogProps) {
  const columns = sortColumnOptions(worksheet, range);
  const [sortBy, setSortBy] = useState<string>(columns.length > 0 ? String(columns[0].column) : "");
  const [order, setOrder] = useState<SortOrder>("ascending");
  const [hasHeader, setHasHeader] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (saving) return;
    if (sortBy === "") {
      setError(SORT_COLUMN_REQUIRED_MESSAGE);
      return;
    }
    setSaving(true);
    setError("");
    try {
      onSorted(
        await sortWorksheetRange(workbookId, worksheet.id, {
          range,
          column: Number(sortBy),
          order,
          hasHeader,
        }),
      );
      onOpenChange(false);
    } catch (cause) {
      // The stored order is untouched: the grid keeps the previous row order.
      setError(cause instanceof ApiError ? cause.message : SORT_SAVE_ERROR);
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      title="Sort range"
      onOpenChange={onOpenChange}
      actions={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={saving}>
            Sort
          </Button>
        </>
      }
    >
      <Combobox
        id="sort-range-by"
        label="Sort by"
        value={sortBy}
        onChange={(event) => setSortBy(event.target.value)}
        options={columns.map((column) => ({ value: String(column.column), label: column.label }))}
      />
      <Combobox
        id="sort-range-order"
        label="Order"
        value={order}
        onChange={(event) => setOrder(event.target.value as SortOrder)}
        options={SORT_ORDER_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
      />
      <div className="ui-field">
        <label htmlFor="sort-range-header-row">
          <input
            id="sort-range-header-row"
            type="checkbox"
            checked={hasHeader}
            onChange={(event) => setHasHeader(event.target.checked)}
          />
          {" "}
          Data has header row
        </label>
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </Dialog>
  );
}

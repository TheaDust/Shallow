import { useEffect, useState } from "react";

import { regionToRef, type CellRegion } from "../lib/cells";
import { Button, Combobox, Dialog } from "../ui";
import { requestErrorMessage } from "../workbooks/api";
import type { SortOrder, SortRequestInput, WorksheetData } from "../workbooks/types";
import { SORT_ORDER_OPTIONS, looksLikeHeaderRow, sortColumnOptions } from "./sort";

export interface SortRangeDialogProps {
  open: boolean;
  /** Selected rectangle the sort reorders. */
  range: CellRegion;
  /** Active worksheet the `Sort by` options read their header texts from. */
  worksheet: WorksheetData;
  onOpenChange(open: boolean): void;
  /** Sorts the range; a rejection keeps the dialog open with its message and the grid order. */
  onSort(payload: SortRequestInput): Promise<void>;
}

/**
 * `Sort range` dialog of the `Data` menu: the `Sort by` combo box names the columns of the selected
 * range by their header text, `Order` chooses `Ascending` or `Descending`, and the
 * `Data has header row` checkbox keeps the first row out of the sort.
 */
export function SortRangeDialog({ open, range, worksheet, onOpenChange, onSort }: SortRangeDialogProps) {
  const columns = sortColumnOptions(worksheet, range);
  const [column, setColumn] = useState(String(columns[0]?.column ?? range.left));
  const [order, setOrder] = useState<SortOrder>("ascending");
  const [hasHeader, setHasHeader] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setColumn(String(sortColumnOptions(worksheet, range)[0]?.column ?? range.left));
    setOrder("ascending");
    setHasHeader(looksLikeHeaderRow(worksheet, range));
    setError(null);
    setSubmitting(false);
  }, [open, worksheet, range]);

  const sort = async () => {
    setError(null);
    const index = Number(column);
    if (!Number.isInteger(index)) {
      setError("Choose the column to sort by");
      return;
    }
    setSubmitting(true);
    try {
      await onSort({ range: regionToRef(range), column: index, order, hasHeader });
    } catch (sortError) {
      setError(requestErrorMessage(sortError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Sort range"
      onOpenChange={onOpenChange}
      actions={
        <Button variant="primary" onClick={() => void sort()} disabled={submitting}>
          Sort
        </Button>
      }
    >
      <div className="sort-dialog">
        <p className="sort-dialog__range">Range: {regionToRef(range)}</p>
        <Combobox
          label="Sort by"
          value={column}
          options={columns.map((option) => ({ value: option.value, label: option.label }))}
          onChange={(event) => setColumn(event.target.value)}
        />
        <Combobox
          label="Order"
          value={order}
          options={SORT_ORDER_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          onChange={(event) => setOrder(event.target.value as SortOrder)}
        />
        <label className="sort-dialog__header">
          <input type="checkbox" checked={hasHeader} onChange={(event) => setHasHeader(event.target.checked)} />
          Data has header row
        </label>
        {error ? (
          <p className="sort-dialog__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

import { useState, type FormEvent } from "react";

import { Button } from "../../ui/Button";
import { Combobox } from "../../ui/Combobox";
import { Dialog } from "../../ui/Dialog";
import { DEFAULT_SORT_ORDER, SORT_ORDER_OPTIONS, sortColumnOptions } from "../../domain/sort";
import { errorMessage } from "../../lib/workbooks-api";
import type { CellRange, SortOrder, SortRangeSpec, Worksheet } from "../../domain/types";

export interface SortRangeDialogProps {
  /** Worksheet holding the range; its first row provides the column headers. */
  worksheet: Worksheet;
  /** Rectangle to reorder (the current selection). */
  range: CellRange;
  onClose(): void;
  onSort(spec: SortRangeSpec): Promise<unknown>;
}

/**
 * "Sort range" dialog: picks the column whose header text names the sort key,
 * the direction, and whether the first row of the range is a header that stays
 * out of the sort. Submitting sends the whole sort to the store, which
 * reorders the records in one write; a rejection keeps the dialog open, shows
 * the message and leaves the grid in its original order.
 */
export function SortRangeDialog({ worksheet, range, onClose, onSort }: SortRangeDialogProps) {
  const options = sortColumnOptions(worksheet, range);
  const [sortBy, setSortBy] = useState<string>(options[0]?.value ?? String(range.minCol));
  const [order, setOrder] = useState<SortOrder>(DEFAULT_SORT_ORDER);
  const [hasHeaderRow, setHasHeaderRow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSort({ range, col: Number(sortBy), order, hasHeaderRow });
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title="Sort range"
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <form className="sort-range-dialog" onSubmit={submit}>
        <Combobox
          label="Sort by"
          value={sortBy}
          options={options}
          onChange={(event) => setSortBy(event.target.value)}
        />
        <Combobox
          label="Order"
          value={order}
          options={SORT_ORDER_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          onChange={(event) => setOrder(event.target.value as SortOrder)}
        />
        <label className="sort-range-dialog__header-row">
          <input
            type="checkbox"
            checked={hasHeaderRow}
            onChange={(event) => setHasHeaderRow(event.target.checked)}
          />
          Data has header row
        </label>
        {error ? <p className="ui-field__error" role="alert">{error}</p> : null}
        <div className="form-actions">
          <Button type="submit" variant="primary" disabled={busy}>Sort</Button>
        </div>
      </form>
    </Dialog>
  );
}

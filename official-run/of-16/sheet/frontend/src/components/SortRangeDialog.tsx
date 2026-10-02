import { useState, type FormEvent } from "react";

import {
  SORT_ORDERS,
  type SortColumnOption,
  type SortOrder,
  type SortRangeOptions,
} from "../domain/sort";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { Dialog } from "../ui/Dialog";

const SORT_BY_FIELD_ID = "sort-range-column";
const ORDER_FIELD_ID = "sort-range-order";
const HEADER_FIELD_ID = "sort-range-header";

export interface SortRangeDialogProps {
  /** A1 range the sort applies to: the current selection. */
  target: string;
  /** One option per column of the range, named after its header text. */
  columns: readonly SortColumnOption[];
  /** Initial state of the "Data has header row" checkbox. */
  defaultHasHeaderRow?: boolean;
  error?: string | null;
  busy?: boolean;
  onSubmit(request: SortRangeOptions): void;
  onOpenChange(open: boolean): void;
}

/**
 * "Sort range" dialog (REQ-5-1-1).
 *
 * `Sort by` offers the header texts of the selected range, `Order` the visible
 * order names `Ascending`/`Descending`, and the `Data has header row` checkbox
 * declares whether the first row stays out of the sort. `Sort` sends the whole
 * request at once; a rejected sort is reported beside the controls while the
 * grid keeps its original order.
 */
export function SortRangeDialog({
  target,
  columns,
  defaultHasHeaderRow = false,
  error = null,
  busy = false,
  onSubmit,
  onOpenChange,
}: SortRangeDialogProps) {
  const [column, setColumn] = useState(() => columns[0]?.value ?? "");
  const [order, setOrder] = useState<SortOrder>("ascending");
  const [hasHeaderRow, setHasHeaderRow] = useState(defaultHasHeaderRow);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const index = Number(column);
    if (!Number.isInteger(index)) return;
    onSubmit({ column: index, order, hasHeaderRow });
  }

  return (
    <Dialog
      open
      title="Sort range"
      closeLabel="Close sort range dialog"
      description={`Range ${target}`}
      onOpenChange={(open) => {
        if (!open && !busy) onOpenChange(false);
      }}
    >
      <form id="sort-range-form" className="sort-range" onSubmit={submit} noValidate>
        <Combobox
          id={SORT_BY_FIELD_ID}
          label="Sort by"
          value={column}
          disabled={busy}
          onChange={(event) => setColumn(event.target.value)}
          options={columns.map((entry) => ({ value: entry.value, label: entry.label }))}
        />
        <Combobox
          id={ORDER_FIELD_ID}
          label="Order"
          value={order}
          disabled={busy}
          onChange={(event) => setOrder(event.target.value as SortOrder)}
          options={SORT_ORDERS.map((entry) => ({ value: entry.value, label: entry.label }))}
        />
        <div className="sort-range__header">
          <input
            id={HEADER_FIELD_ID}
            name="has-header-row"
            type="checkbox"
            checked={hasHeaderRow}
            disabled={busy}
            onChange={(event) => setHasHeaderRow(event.target.checked)}
          />
          <label htmlFor={HEADER_FIELD_ID}>Data has header row</label>
        </div>
        {error ? <p role="alert" className="sort-range__error">{error}</p> : null}
        <div className="sort-range__actions">
          <Button type="submit" variant="primary" disabled={busy}>Sort</Button>
        </div>
        {busy ? <p role="status">Sorting range…</p> : null}
      </form>
    </Dialog>
  );
}

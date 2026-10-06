import { useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { Dialog } from "../ui/Dialog";
import { SORT_ORDER_OPTIONS, type SortColumn, type SortOrder } from "../domain/sort";

export interface SortRangeValues {
  /** Absolute 1-based column to sort by. */
  column: number;
  order: SortOrder;
  /** Whether the range's first row is a header and keeps its place. */
  hasHeaderRow: boolean;
}

export interface SortRangeDialogProps {
  open: boolean;
  /** Columns of the range; option names are their header texts. */
  columns: SortColumn[];
  onOpenChange(open: boolean): void;
  /** Persist the sort; a rejected sort keeps the dialog open with its message. */
  onSort(values: SortRangeValues): Promise<void>;
}

const SORT_BY_FIELD_ID = "sort-range-by";
const ORDER_FIELD_ID = "sort-range-order";
const HEADER_FIELD_ID = "sort-range-header";

/**
 * Dialog for sorting the selected range. It collects the sort column, the
 * direction and whether the first row is a header; the server performs the
 * whole reorder in one atomic write.
 */
export function SortRangeDialog({ open, columns, onOpenChange, onSort }: SortRangeDialogProps) {
  const [column, setColumn] = useState("");
  const [order, setOrder] = useState<SortOrder>("asc");
  const [hasHeaderRow, setHasHeaderRow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(open);

  // Reset the form from scratch as the dialog opens, during render, so the
  // first committed paint already shows the default column and order.
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setColumn(columns.length ? String(columns[0].column) : "");
    setOrder("asc");
    setHasHeaderRow(true);
    setError(null);
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const selected = Number(column);
    if (!Number.isInteger(selected)) {
      setError("Please choose a column to sort by");
      return;
    }
    setBusy(true);
    setError(null);
    onSort({ column: selected, order, hasHeaderRow })
      .then(() => onOpenChange(false))
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Unable to sort the range");
        setBusy(false);
      });
  };

  return (
    <Dialog open={open} title="Sort range" onOpenChange={onOpenChange}>
      <form className="sort-range" aria-label="Sort range" onSubmit={submit}>
        <Combobox
          id={SORT_BY_FIELD_ID}
          label="Sort by"
          options={columns.map((entry) => ({ value: String(entry.column), label: entry.label }))}
          value={column}
          disabled={busy}
          onChange={(event) => setColumn(event.target.value)}
        />
        <Combobox
          id={ORDER_FIELD_ID}
          label="Order"
          options={[...SORT_ORDER_OPTIONS]}
          value={order}
          disabled={busy}
          onChange={(event) => setOrder(event.target.value as SortOrder)}
        />
        <label className="sort-range__header" htmlFor={HEADER_FIELD_ID}>
          <input
            id={HEADER_FIELD_ID}
            type="checkbox"
            checked={hasHeaderRow}
            disabled={busy}
            onChange={(event) => setHasHeaderRow(event.target.checked)}
          />
          <span>Data has header row</span>
        </label>
        {error ? (
          <p className="sort-range__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="sort-range__actions">
          <Button type="submit" variant="primary" disabled={busy}>
            Sort
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

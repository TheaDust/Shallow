import { useState } from "react";

import { ORDER_LABELS, SORT_ORDERS, type SortColumnOption, type SortOrder } from "../lib/sort-range";
import { Button, Combobox, Dialog } from "../ui";

export interface SortRangeDialogProps {
  /** One option per column of the selected range, named by the header text of that column. */
  columns: readonly SortColumnOption[];
  busy: boolean;
  error?: string | null;
  onSort(request: { column: string; order: SortOrder; hasHeaderRow: boolean }): void;
  onClose(): void;
}

/**
 * `Sort range` dialog of the `Data` menu (REQ-5-1-1). It describes the request only: the selected
 * range is sorted by the chosen column, in the chosen order, and its first row stays out of the
 * sort while `Data has header row` is declared.
 *
 * The dialog is mounted when it opens, so it always starts from the current selection.
 */
export function SortRangeDialog({ columns, busy, error, onSort, onClose }: SortRangeDialogProps) {
  const [column, setColumn] = useState(columns[0]?.value ?? "");
  const [order, setOrder] = useState<SortOrder>(SORT_ORDERS[0]);
  const [hasHeaderRow, setHasHeaderRow] = useState(true);

  return (
    <Dialog
      open
      title="Sort range"
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      actions={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => onSort({ column, order, hasHeaderRow })} disabled={busy}>Sort</Button>
        </>
      )}
    >
      {error ? <p role="alert" className="ui-field__error">{error}</p> : null}
      <Combobox
        label="Sort by"
        value={column}
        disabled={busy}
        onChange={(event) => setColumn(event.target.value)}
        options={columns.map((option) => ({ value: option.value, label: option.label }))}
      />
      <Combobox
        label="Order"
        value={order}
        disabled={busy}
        onChange={(event) => setOrder(event.target.value as SortOrder)}
        options={SORT_ORDERS.map((value) => ({ value, label: ORDER_LABELS[value] }))}
      />
      <label className="ui-checkbox">
        <input
          type="checkbox"
          checked={hasHeaderRow}
          disabled={busy}
          onChange={(event) => setHasHeaderRow(event.target.checked)}
        />
        Data has header row
      </label>
    </Dialog>
  );
}

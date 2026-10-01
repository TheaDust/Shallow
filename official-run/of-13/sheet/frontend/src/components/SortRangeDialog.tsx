import { useState } from "react";

import { SORT_ORDER_OPTIONS, type SortColumnOption, type SortOrder } from "../domain/sort";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { Dialog } from "../ui/Dialog";

/** What the `Sort` button submits for the selected rectangle. */
export interface SortDraft {
  /** Column letter inside the rectangle, chosen by the option named after its header text. */
  column: string;
  order: SortOrder;
  hasHeader: boolean;
}

export interface SortRangeDialogProps {
  /** Rectangle of the current selection, e.g. `A1:C4`. */
  range: string;
  /** Columns of the rectangle, in order, each named after its header text. */
  columns: readonly SortColumnOption[];
  /** Starting state of `Data has header row`: true when the first row looks like a header. */
  hasHeader: boolean;
  busy?: boolean;
  error?: string;
  onSort(draft: SortDraft): void;
  onClose(): void;
}

/**
 * `Sort range` dialog (REQ-5-1-1): chooses the column to sort by (named after the header text
 * of the selected rectangle), the direction, and whether the first row is a header that stays
 * on top. `Sort` submits the request; a refusal shows the server message while the grid keeps
 * its previous order.
 */
export function SortRangeDialog({
  range,
  columns,
  hasHeader,
  busy = false,
  error = "",
  onSort,
  onClose,
}: SortRangeDialogProps) {
  const [column, setColumn] = useState(columns[0]?.value ?? "");
  const [order, setOrder] = useState<SortOrder>("ascending");
  const [headerRow, setHeaderRow] = useState(hasHeader);

  return (
    <Dialog
      open
      title="Sort range"
      description={`Range ${range}`}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      actions={
        <>
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || columns.length === 0}
            onClick={() => onSort({ column, order, hasHeader: headerRow })}
          >
            Sort
          </Button>
        </>
      }
    >
      <Combobox
        label="Sort by"
        value={column}
        disabled={busy || columns.length === 0}
        options={columns.map((option) => ({ value: option.value, label: option.label }))}
        onChange={(event) => setColumn(event.target.value)}
      />
      <Combobox
        label="Order"
        value={order}
        disabled={busy}
        options={SORT_ORDER_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
        onChange={(event) => setOrder(event.target.value as SortOrder)}
      />
      <label className="sort-range-dialog__header-row">
        <input
          type="checkbox"
          checked={headerRow}
          disabled={busy}
          onChange={(event) => setHeaderRow(event.target.checked)}
        />
        Data has header row
      </label>
      {error ? (
        <p role="alert" className="page-error">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

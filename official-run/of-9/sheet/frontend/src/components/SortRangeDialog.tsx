import { useEffect, useState } from "react";

import type { CellRange, Workbook } from "../domain/types";
import { columnLabel } from "../domain/grid";
import { sortRange } from "../lib/api";
import { Button, Combobox, Dialog, FormField } from "../ui";

export interface SortRangeDialogProps {
  open: boolean;
  workbookId: string;
  sheetId: string;
  range: CellRange;
  /** Header texts of the selected range, one per column. */
  headers: readonly string[];
  onOpenChange(open: boolean): void;
  onSaved(workbook: Workbook): void;
}

/**
 * The "Sort range" dialog. "Sort by" lists the header texts of the selected
 * range as options, "Order" offers "Ascending"/"Descending", and the
 * "Data has header row" checkbox keeps the first row in place. "Sort" applies
 * the sort and closes on success.
 */
export function SortRangeDialog({
  open,
  workbookId,
  sheetId,
  range,
  headers,
  onOpenChange,
  onSaved,
}: SortRangeDialogProps) {
  const [sortBy, setSortBy] = useState(range.start.column);
  const [order, setOrder] = useState<"ascending" | "descending">("ascending");
  const [hasHeaderRow, setHasHeaderRow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    setSortBy(range.start.column);
    setOrder("ascending");
    setHasHeaderRow(true);
  }, [open, range]);

  const sort = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const workbook = await sortRange(workbookId, sheetId, { range, sortBy, order, hasHeaderRow });
      onSaved(workbook);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to sort range");
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Sort range"
      onOpenChange={onOpenChange}
      actions={
        <Button variant="primary" disabled={busy} onClick={() => void sort()}>
          Sort
        </Button>
      }
    >
      <div className="sort-range-dialog__form">
        <Combobox
          label="Sort by"
          options={headers.map((header, offset) => ({
            value: String(range.start.column + offset),
            label: header === "" ? columnLabel(range.start.column + offset - 1) : header,
          }))}
          value={String(sortBy)}
          onChange={(event) => {
            setSortBy(Number(event.target.value));
            setError(null);
          }}
        />
        <Combobox
          label="Order"
          options={[
            { value: "ascending", label: "Ascending" },
            { value: "descending", label: "Descending" },
          ]}
          value={order}
          onChange={(event) => {
            setOrder(event.target.value as "ascending" | "descending");
            setError(null);
          }}
        />
        <FormField id="sort-range-header-row" label="Data has header row">
          <input
            id="sort-range-header-row"
            type="checkbox"
            checked={hasHeaderRow}
            onChange={(event) => setHasHeaderRow(event.target.checked)}
          />
        </FormField>
      </div>
      {error ? (
        <p role="alert" className="sort-range-dialog__error">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

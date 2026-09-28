import { useState } from "react";

import { Dialog } from "./Dialog";
import type { CellRange } from "../lib/spreadsheet";
import type { SortPayload } from "../lib/workbooks";

export interface SortHeader {
  /** Column letter of the range column, e.g. "A". */
  column: string;
  /** Header text used as the option's accessible name. */
  text: string;
}

interface SortDialogProps {
  range: CellRange;
  /** One entry per column of the selected range (header texts). */
  headers: SortHeader[];
  onSort: (payload: SortPayload) => Promise<void>;
  onClose: () => void;
}

/**
 * The "Sort range" dialog (REQ-5-1-1). A "Sort by" combo box lists the
 * header texts of the selected range, an "Order" combo box offers
 * "Ascending"/"Descending", a "Data has header row" checkbox declares the
 * first row a header (it then does not participate in sorting), and the
 * "Sort" button applies the sort. The sorted layout is persisted by the
 * backend; on failure the dialog shows the error and the grid keeps its
 * original order.
 */
export function SortDialog({ range, headers, onSort, onClose }: SortDialogProps) {
  const [sortBy, setSortBy] = useState<string>(headers[0]?.column ?? "A");
  const [order, setOrder] = useState<string>("Ascending");
  const [hasHeader, setHasHeader] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sort() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSort({
        start: range.start,
        end: range.end,
        column: sortBy,
        order: order === "Descending" ? "descending" : "ascending",
        hasHeader,
      });
      onClose();
    } catch (sortError) {
      setError(sortError instanceof Error ? sortError.message : String(sortError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog label="Sort range" onClose={onClose}>
      <h2>Sort range</h2>

      <div className="dialog-field">
        <label htmlFor="sort-by">Sort by</label>
        <select
          id="sort-by"
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value)}
        >
          {headers.map((header) => (
            <option key={header.column} value={header.column}>
              {header.text}
            </option>
          ))}
        </select>
      </div>

      <div className="dialog-field">
        <label htmlFor="sort-order">Order</label>
        <select
          id="sort-order"
          value={order}
          onChange={(event) => setOrder(event.target.value)}
        >
          <option value="Ascending">Ascending</option>
          <option value="Descending">Descending</option>
        </select>
      </div>

      <div className="dialog-field">
        <label htmlFor="sort-header-row" className="dialog-checkbox-row">
          <input
            id="sort-header-row"
            type="checkbox"
            checked={hasHeader}
            onChange={(event) => setHasHeader(event.target.checked)}
          />
          Data has header row
        </label>
      </div>

      {error && (
        <p role="alert" className="dialog-error">
          {error}
        </p>
      )}

      <div className="dialog-actions">
        <button type="button" className="primary" onClick={() => void sort()} disabled={busy}>
          Sort
        </button>
        <button type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

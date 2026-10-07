import { useRef, useState } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import type { SavedFilterView } from "../domain/types";

export interface FilterViewsDialogProps {
  open: boolean;
  /** Saved views of the workbook, in save order. */
  views: SavedFilterView[];
  /** Name of the view whose criteria are applied, shown as selected. */
  selectedName: string | null;
  onOpenChange(open: boolean): void;
  /** Applies a view's criteria; the interface stays open with that view selected. */
  onSelect(name: string): Promise<void>;
  /** Deletes a view and restores every source row it filtered. */
  onDelete(name: string): Promise<void>;
}

/**
 * Management interface for the workbook's saved filter views: one control per
 * view, named exactly like the view, plus "Delete filter view" acting on the
 * selected one. Choosing a view replaces the current filters and keeps this
 * interface open with that view selected; deleting it removes the view and
 * restores all source rows without changing any cell value.
 */
export function FilterViewsDialog({
  open,
  views,
  selectedName,
  onOpenChange,
  onSelect,
  onDelete,
}: FilterViewsDialogProps) {
  const [selected, setSelected] = useState<string | null>(selectedName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(open);

  // Prefill the selection from the applied view as the dialog opens, during
  // render, so the first painted frame already marks the chosen view.
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setSelected(selectedName && views.some((view) => view.name === selectedName) ? selectedName : null);
    setError(null);
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const choose = async (name: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSelect(name);
      setSelected(name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to apply the filter view");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy || !selected) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(selected);
      setSelected(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete the filter view");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title="Filter views" onOpenChange={onOpenChange}>
      <div className="filter-views">
        {views.length === 0 ? (
          <p className="filter-views__empty">No saved filter views yet</p>
        ) : (
          <ul className="filter-views__list">
            {views.map((view) => (
              <li key={view.name} className="filter-views__item">
                <Button
                  aria-pressed={selected === view.name}
                  disabled={busy}
                  onClick={() => void choose(view.name)}
                >
                  {view.name}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error ? (
          <p className="filter-views__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="filter-views__actions">
          <Button variant="danger" disabled={busy || !selected} onClick={() => void remove()}>
            Delete filter view
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

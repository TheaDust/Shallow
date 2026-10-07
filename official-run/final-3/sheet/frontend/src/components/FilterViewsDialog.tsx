import { useRef, useState } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import type { FilterView } from "../domain/types";

export interface FilterViewsDialogProps {
  open: boolean;
  /** Saved filter views of the active worksheet, in the order they were saved. */
  views: FilterView[];
  onOpenChange(open: boolean): void;
  /** Apply one saved view's criteria; a rejection keeps this interface open. */
  onApply(view: FilterView): Promise<void>;
  /** Delete one saved view and restore every source row. */
  onDelete(name: string): Promise<void>;
}

/** Message shown while the worksheet holds no saved filter view. */
export const NO_FILTER_VIEWS_MESSAGE = "No saved filter views";

/**
 * Interface for the saved filter views of the active worksheet. Each saved view
 * is one control named after it: choosing a view replaces the worksheet's
 * current filters and keeps this interface open with that view selected, so
 * "Delete filter view" can immediately remove it. Deleting restores every
 * source row, and both a chosen and a deleted view persist for the next visit.
 */
export function FilterViewsDialog({ open, views, onOpenChange, onApply, onDelete }: FilterViewsDialogProps) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(open);

  // A freshly opened interface shows the current list with nothing selected,
  // during render, so the first paint never shows stale state.
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setSelectedName(null);
    setError(null);
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  // A view that is gone (deleted) can no longer be the selected one.
  const selected = selectedName !== null && views.some((view) => view.name === selectedName) ? selectedName : null;

  const choose = (view: FilterView) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    onApply(view)
      .then(() => {
        setSelectedName(view.name);
        setBusy(false);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Unable to apply the filter view");
        setBusy(false);
      });
  };

  const remove = () => {
    if (busy || selected === null) return;
    setBusy(true);
    setError(null);
    onDelete(selected)
      .then(() => {
        setSelectedName(null);
        setBusy(false);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Unable to delete the filter view");
        setBusy(false);
      });
  };

  return (
    <Dialog open={open} title="Filter views" onOpenChange={onOpenChange}>
      <div className="filter-views">
        {views.length === 0 ? (
          <p className="filter-views__empty">{NO_FILTER_VIEWS_MESSAGE}</p>
        ) : (
          <ul className="filter-views__list">
            {views.map((view) => {
              const isSelected = view.name === selected;
              return (
                <li key={view.name}>
                  <Button
                    className="filter-views__view"
                    data-view={view.name}
                    aria-selected={isSelected}
                    aria-pressed={isSelected}
                    disabled={busy}
                    onClick={() => choose(view)}
                  >
                    {view.name}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {error ? (
          <p className="filter-views__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="filter-views__actions">
          <Button variant="danger" disabled={busy || selected === null} onClick={remove}>
            Delete filter view
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

import { useRef, useState } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import type { WorksheetFilterView } from "../domain/types";

export interface FilterViewsDialogProps {
  open: boolean;
  /** Saved views of the active worksheet, in stored order. */
  views: WorksheetFilterView[];
  /** Id of the view whose criteria are applied right now, or `null`. */
  selectedId: string | null;
  onOpenChange(open: boolean): void;
  /** Replace the current filter with the criteria of one saved view. */
  onApply(viewId: string): Promise<void>;
  /** Remove the selected view and restore every source row. */
  onDelete(viewId: string): Promise<void>;
}

/**
 * Management interface of the saved filter views. Choosing a view applies its
 * criteria without closing this interface: the chosen view stays selected and
 * the list keeps every saved view for further operations. "Delete filter view"
 * removes the selected one, also restoring every source row.
 */
export function FilterViewsDialog({
  open,
  views,
  selectedId,
  onOpenChange,
  onApply,
  onDelete,
}: FilterViewsDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(open);

  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setError(null);
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const run = (action: () => Promise<void>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    action()
      .then(() => setBusy(false))
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : fallback);
        setBusy(false);
      });
  };

  return (
    <Dialog open={open} title="Filter views" onOpenChange={onOpenChange}>
      <div className="filter-views">
        {views.length === 0 ? (
          <p className="filter-views__empty">No saved filter views.</p>
        ) : (
          <ul className="filter-views__list" aria-label="Saved filter views">
            {views.map((view) => (
              <li key={view.id} className="filter-views__item">
                <Button
                  aria-pressed={view.id === selectedId}
                  disabled={busy}
                  onClick={() => run(() => onApply(view.id), "Unable to apply the filter view")}
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
          <Button
            variant="danger"
            disabled={busy || selectedId === null}
            onClick={() => {
              const target = selectedId;
              if (target) run(() => onDelete(target), "Unable to delete the filter view");
            }}
          >
            Delete filter view
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

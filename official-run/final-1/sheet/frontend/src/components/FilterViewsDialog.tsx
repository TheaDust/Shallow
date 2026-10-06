import { useRef, useState } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import type { FilterView } from "../domain/types";

export interface FilterViewsDialogProps {
  open: boolean;
  /** Views saved in the workbook, in the order they were saved. */
  views: FilterView[];
  /** Id of the view chosen in this interface, or `null` when none is chosen. */
  selectedId: string | null;
  onOpenChange(open: boolean): void;
  /** Replace the worksheet's filters with the criteria of `view`. */
  onChoose(view: FilterView): Promise<void>;
  /** Remove the selected view and restore all source rows. */
  onDelete(): Promise<void>;
}

/**
 * Management interface of a workbook's saved filter views. Every saved view is
 * offered as its own control; choosing one applies its criteria and keeps the
 * interface open with that view marked as selected, so it can be deleted right
 * afterwards. Deleting removes the view and brings every source row back.
 */
export function FilterViewsDialog({
  open,
  views,
  selectedId,
  onOpenChange,
  onChoose,
  onDelete,
}: FilterViewsDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(open);

  // A reopened interface starts without the report of a previous attempt.
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setError(null);
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const run = async (action: () => Promise<void>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title="Filter views" onOpenChange={onOpenChange}>
      <div className="filter-views">
        {views.length === 0 ? (
          <p className="filter-views__empty" role="status">
            No saved filter views
          </p>
        ) : (
          <div className="filter-views__list">
            {views.map((view) => (
              <Button
                key={view.id}
                aria-pressed={view.id === selectedId}
                disabled={busy}
                onClick={() => void run(() => onChoose(view), "Unable to apply the filter view")}
              >
                {view.name}
              </Button>
            ))}
          </div>
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
            onClick={() => void run(onDelete, "Unable to delete the filter view")}
          >
            Delete filter view
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

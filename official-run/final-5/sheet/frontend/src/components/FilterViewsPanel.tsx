import { useId, useState } from "react";

import { Button } from "../ui/Button";
import type { FilterView } from "../domain/types";

export interface FilterViewsPanelProps {
  open: boolean;
  /** Saved views of the active worksheet, in the order they were saved. */
  views: FilterView[];
  onClose(): void;
  /** Apply a view's criteria; the interface stays open with that view selected. */
  onApply(view: FilterView): Promise<void>;
  /** Delete a view and restore all source rows of the range. */
  onDelete(view: FilterView): Promise<void>;
}

/**
 * View-management interface of the "Filter views" command. Every saved view is
 * a control named after it; choosing one replaces the worksheet's current
 * filters and keeps this interface open with the view selected, so
 * "Delete filter view" acts on the selected view. It is an inline panel so the
 * chosen rows stay observable next to the interface.
 */
export function FilterViewsPanel({ open, views, onClose, onApply, onDelete }: FilterViewsPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleId = useId();

  if (!open) return null;

  const run = (action: () => Promise<void>, fallback: string, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    action()
      .then(() => after?.())
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : fallback))
      .finally(() => setBusy(false));
  };

  const choose = (view: FilterView) => {
    setSelectedId(view.id);
    run(() => onApply(view), "Unable to apply the filter view");
  };

  const remove = () => {
    const target = views.find((view) => view.id === selectedId);
    if (!target) return;
    run(() => onDelete(target), "Unable to delete the filter view", () => setSelectedId(null));
  };

  return (
    <section className="filter-panel" aria-labelledby={titleId}>
      <header className="filter-panel__header">
        <h2 id={titleId}>Filter views</h2>
        <Button variant="ghost" aria-label="Close" onClick={onClose}>
          ×
        </Button>
      </header>
      <div className="filter-views">
        {views.length === 0 ? (
          <p className="filter-views__empty">No filter views have been saved yet.</p>
        ) : (
          <ul className="filter-views__list">
            {views.map((view) => (
              <li key={view.id}>
                <Button
                  variant={selectedId === view.id ? "primary" : "secondary"}
                  aria-pressed={selectedId === view.id}
                  disabled={busy}
                  onClick={() => choose(view)}
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
          <Button variant="danger" disabled={busy || selectedId === null} onClick={remove}>
            Delete filter view
          </Button>
        </div>
      </div>
    </section>
  );
}

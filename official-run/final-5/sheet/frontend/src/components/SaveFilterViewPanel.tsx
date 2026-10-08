import { useId, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { FormField, fieldDescriptionIds } from "../ui/FormField";

export interface SaveFilterViewPanelProps {
  open: boolean;
  /** Dismiss the interface; the applied filter keeps working either way. */
  onClose(): void;
  /**
   * Persist the currently applied filter under `name`. A rejection (for example
   * `Filter view name already exists`) keeps the interface open with the
   * message shown and the entered name intact.
   */
  onSave(name: string): Promise<void>;
}

const NAME_FIELD_ID = "filter-view-name";

/**
 * Save interface of the "Save filter view" command: one text box for the view
 * name and a "Save view" button. It is an inline panel rather than a modal, so
 * a rejected save stays visible while the visitor can still use the rest of the
 * worksheet and the "Data" menu. The name is validated by the server (trimmed,
 * nonempty, unique within the workbook), so a rejection shows the server's
 * exact message in place instead of closing.
 */
export function SaveFilterViewPanel({ open, onClose, onSave }: SaveFilterViewPanelProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleId = useId();

  if (!open) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    onSave(name)
      .then(() => {
        setName("");
        setBusy(false);
        onClose();
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Unable to save the filter view");
        setBusy(false);
      });
  };

  return (
    <section className="filter-panel" aria-labelledby={titleId}>
      <header className="filter-panel__header">
        <h2 id={titleId}>Save filter view</h2>
        <Button variant="ghost" aria-label="Close" onClick={onClose}>
          ×
        </Button>
      </header>
      <form className="save-filter-view" onSubmit={submit}>
        <FormField id={NAME_FIELD_ID} label="Filter view name">
          <input
            id={NAME_FIELD_ID}
            type="text"
            value={name}
            disabled={busy}
            aria-describedby={fieldDescriptionIds(NAME_FIELD_ID, { error: Boolean(error) })}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        {error ? (
          <p className="save-filter-view__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="save-filter-view__actions">
          <Button type="submit" variant="primary" disabled={busy}>
            Save view
          </Button>
        </div>
      </form>
    </section>
  );
}

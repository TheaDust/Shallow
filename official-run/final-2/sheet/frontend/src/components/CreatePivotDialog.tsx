import { useRef, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

export interface CreatePivotDialogProps {
  open: boolean;
  /** A1 area of the selected source range, shown as `Source range: <cell range>`. */
  range: string;
  onOpenChange(open: boolean): void;
  /** Creates the pivot worksheet; a rejection keeps the dialog open. */
  onCreate(): Promise<void>;
}

/**
 * Asks where the pivot table should live before it is created. The only
 * destination offered is a new worksheet, which takes the first unused `PivotN`
 * name and holds the summary; the source worksheet is never modified.
 */
export function CreatePivotDialog({ open, range, onOpenChange, onCreate }: CreatePivotDialogProps) {
  const [destination, setDestination] = useState("new-worksheet");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(open);

  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setDestination("new-worksheet");
    setError(null);
    setBusy(false);
  } else if (!open && wasOpen.current) {
    wasOpen.current = false;
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    onCreate()
      .then(() => onOpenChange(false))
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Unable to create the pivot table");
        setBusy(false);
      });
  };

  return (
    <Dialog open={open} title="Create pivot table" onOpenChange={onOpenChange}>
      <form className="create-pivot" onSubmit={submit}>
        <p className="create-pivot__range">{`Source range: ${range}`}</p>
        <label className="create-pivot__destination">
          <input
            type="radio"
            name="pivot-destination"
            value="new-worksheet"
            checked={destination === "new-worksheet"}
            disabled={busy}
            onChange={() => setDestination("new-worksheet")}
          />
          <span>New worksheet</span>
        </label>
        {error ? (
          <p className="create-pivot__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="create-pivot__actions">
          <Button type="submit" variant="primary" disabled={busy}>
            Create
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

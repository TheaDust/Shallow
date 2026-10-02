import { useEffect, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";

const NAME_FIELD_ID = "worksheet-name";
const EMPTY_NAME_ERROR = "Worksheet name cannot be empty";

export interface RenameWorksheetDialogProps {
  /** Current worksheet name; the text box is prefilled with it. */
  initialName: string;
  /** Error reported by the rename request (for example a duplicate name). */
  error?: string | null;
  busy?: boolean;
  onSubmit(name: string): void;
  onOpenChange(open: boolean): void;
}

/**
 * "Rename worksheet" dialog (REQ-2-1-3): a text box labelled `Worksheet name`
 * prefilled with the current name plus a `Save` button. An empty trimmed name is
 * rejected in place; duplicate and request failures are shown beside the control
 * and leave the worksheet's original name untouched.
 */
export function RenameWorksheetDialog({
  initialName,
  error = null,
  busy = false,
  onSubmit,
  onOpenChange,
}: RenameWorksheetDialogProps) {
  const [value, setValue] = useState(initialName);
  const [localError, setLocalError] = useState<string | null>(null);

  // A different worksheet opens the dialog with its own current name.
  useEffect(() => {
    setValue(initialName);
    setLocalError(null);
  }, [initialName]);

  function changeOpen(next: boolean) {
    if (!next && busy) return;
    onOpenChange(next);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const name = value.trim();
    if (!name) {
      setLocalError(EMPTY_NAME_ERROR);
      return;
    }
    setLocalError(null);
    onSubmit(name);
  }

  return (
    <Dialog
      open
      title="Rename worksheet"
      closeLabel="Close rename worksheet dialog"
      onOpenChange={changeOpen}
    >
      <form className="worksheet-rename" onSubmit={submit} noValidate>
        <FormField id={NAME_FIELD_ID} label="Worksheet name" error={localError ?? error ?? undefined}>
          <input
            id={NAME_FIELD_ID}
            name="worksheet-name"
            type="text"
            value={value}
            disabled={busy}
            onChange={(event) => {
              setValue(event.target.value);
              setLocalError(null);
            }}
          />
        </FormField>
        <div className="worksheet-rename__actions">
          <Button type="submit" variant="primary" disabled={busy}>Save</Button>
        </div>
        {busy ? <p role="status">Saving worksheet…</p> : null}
      </form>
    </Dialog>
  );
}

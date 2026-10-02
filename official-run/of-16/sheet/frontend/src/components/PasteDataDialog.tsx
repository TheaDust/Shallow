import { useEffect, useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
const FIELD_ID = "paste-data-text";

export interface PasteDataDialogProps {
  open: boolean;
  /** Clipboard text when the browser allowed reading it; otherwise empty. */
  initialText: string;
  onOpenChange(open: boolean): void;
  onPaste(text: string): void;
}

/**
 * Fallback for the grid menu's "Paste" command (REQ-3-1-2): when the browser
 * refuses to read the clipboard, the user can paste the tab-separated text into
 * this labelled box and apply it to the selected starting cell.
 */
export function PasteDataDialog({ open, initialText, onOpenChange, onPaste }: PasteDataDialogProps) {
  const [text, setText] = useState(initialText);

  useEffect(() => {
    if (open) setText(initialText);
  }, [open, initialText]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onOpenChange(false);
    onPaste(text);
  }

  return (
    <Dialog open={open} title="Paste" closeLabel="Close paste dialog" onOpenChange={onOpenChange}>
      <form className="paste-data" onSubmit={submit} noValidate>
        <FormField id={FIELD_ID} label="Paste data">
          <textarea
            id={FIELD_ID}
            name="paste-data"
            rows={4}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </FormField>
        <div className="paste-data__actions">
          <Button type="submit" variant="primary">Paste</Button>
        </div>
      </form>
    </Dialog>
  );
}

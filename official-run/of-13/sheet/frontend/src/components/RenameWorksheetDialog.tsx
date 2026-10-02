import { useState } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";

export interface RenameWorksheetDialogProps {
  currentName: string;
  onClose(): void;
  /** Resolves when the worksheet was renamed; the rejection message is shown beside the field. */
  onSave(name: string): Promise<void>;
}

export function RenameWorksheetDialog({ currentName, onClose, onSave }: RenameWorksheetDialogProps) {
  const [draft, setDraft] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (saving) return;
    const name = draft.trim();
    if (!name) {
      setError("Worksheet name cannot be empty");
      return;
    }
    setSaving(true);
    try {
      await onSave(name);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to rename worksheet");
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      title="Rename worksheet"
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={saving}>
            Save
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <FormField id="rename-worksheet-name" label="Worksheet name" error={error ?? undefined}>
          <input
            id="rename-worksheet-name"
            name="worksheet-name"
            type="text"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
          />
        </FormField>
      </form>
    </Dialog>
  );
}

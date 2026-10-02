import { useEffect, useState } from "react";

import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";

export interface RenameWorkbookDialogProps {
  currentName: string;
  onClose(): void;
  onSave(name: string): Promise<void>;
}

export function RenameWorkbookDialog({ currentName, onClose, onSave }: RenameWorkbookDialogProps) {
  const [draft, setDraft] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(currentName);
    setError(null);
    setSaving(false);
  }, [currentName]);

  async function submit() {
    if (saving) return;
    const name = draft.trim();
    if (!name) {
      setError("Workbook name cannot be empty");
      return;
    }
    setSaving(true);
    try {
      await onSave(name);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to rename workbook");
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      title="Rename workbook"
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
        <FormField id="rename-workbook-name" label="Workbook name" error={error ?? undefined}>
          <input
            id="rename-workbook-name"
            name="workbook-name"
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </FormField>
      </form>
    </Dialog>
  );
}

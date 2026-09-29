import { useState, type FormEvent } from "react";

import { Button, FormField, fieldDescriptionIds } from "../../ui";
import { errorMessage, renameWorkbook } from "./api";
import type { WorkbookData } from "./types";

export const RENAME_WORKBOOK_FIELD_ID = "rename-workbook-name";
export const EMPTY_WORKBOOK_NAME_MESSAGE = "Workbook name cannot be empty";

export interface RenameWorkbookFormProps {
  workbook: WorkbookData;
  onRenamed(workbook: WorkbookData): void;
  onCancel(): void;
}

/** Inline rename form shown next to the editor title. */
export function RenameWorkbookForm({ workbook, onRenamed, onCancel }: RenameWorkbookFormProps) {
  const [name, setName] = useState(workbook.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (name.trim() === "") {
      setError(EMPTY_WORKBOOK_NAME_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { workbook: saved } = await renameWorkbook(workbook.id, name);
      onRenamed(saved);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <form className="rename-workbook" onSubmit={(event) => void submit(event)}>
      <FormField id={RENAME_WORKBOOK_FIELD_ID} label="Workbook name" error={error ?? undefined}>
        <input
          id={RENAME_WORKBOOK_FIELD_ID}
          type="text"
          value={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={fieldDescriptionIds(RENAME_WORKBOOK_FIELD_ID, { error: Boolean(error) })}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
        />
      </FormField>
      <div className="form-actions">
        <Button type="submit" variant="primary" disabled={busy}>
          Save
        </Button>
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

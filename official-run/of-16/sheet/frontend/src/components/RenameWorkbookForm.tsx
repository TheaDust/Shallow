import { useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { FormField, fieldDescriptionIds } from "../ui/FormField";

export interface RenameWorkbookFormProps {
  initialName: string;
  onSubmit(name: string): Promise<void>;
  onCancel(): void;
}

export function RenameWorkbookForm({ initialName, onSubmit, onCancel }: RenameWorkbookFormProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = "rename-workbook-name";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Workbook name cannot be empty");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(trimmed);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "Could not rename the workbook.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="rename-workbook" aria-label="Rename workbook" onSubmit={submit}>
      <FormField id={inputId} label="Workbook name" error={error ?? undefined}>
        <input
          id={inputId}
          type="text"
          value={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={fieldDescriptionIds(inputId, { error: Boolean(error) })}
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>
      <div className="rename-workbook__actions">
        <Button type="submit" variant="primary" disabled={busy}>Save</Button>
        <Button type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );
}

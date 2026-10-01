import { useState, type FormEvent } from "react";

import { EMPTY_NAME_MESSAGE } from "../editor/RenameWorkbookDialog";
import { errorMessage } from "../hooks/useWorkbook";
import { makeHash, navigate } from "../lib/hash-route";
import { createWorkbook } from "../lib/workbooks";
import { Button, FormField } from "../ui";

const DEFAULT_NAME = "Untitled workbook";

export function NewWorkbookPage() {
  const [name, setName] = useState(DEFAULT_NAME);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError(EMPTY_NAME_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const workbook = await createWorkbook(trimmed);
      navigate(`/workbooks/${encodeURIComponent(workbook.id)}`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="new-workbook">
      <h1 className="new-workbook__title">New workbook</h1>
      <form className="new-workbook__form" onSubmit={submit} noValidate>
        <FormField id="new-workbook-name" label="Workbook name" error={error ?? undefined}>
          <input
            id="new-workbook-name"
            name="workbookName"
            type="text"
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <div className="new-workbook__actions">
          <Button type="submit" variant="primary" disabled={busy}>Create</Button>
        </div>
      </form>
      <p className="new-workbook__back">
        <a href={makeHash("/")}>Back to workbooks</a>
      </p>
    </main>
  );
}

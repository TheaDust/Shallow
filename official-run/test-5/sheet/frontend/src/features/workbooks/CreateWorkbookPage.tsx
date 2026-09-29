import { useState, type FormEvent } from "react";

import { Button, FormField } from "../../ui";
import { makeHash, navigate } from "../../lib/hash-route";
import { createWorkbook, errorMessage } from "./api";

export const WORKBOOK_NAME_FIELD_ID = "new-workbook-name";

export function CreateWorkbookPage() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { workbook } = await createWorkbook(name.trim());
      navigate(`/workbooks/${workbook.id}`);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <main className="create-workbook">
      <header className="create-workbook__header">
        <a href={makeHash("/")}>Workbooks</a>
        <h1>New workbook</h1>
      </header>
      <form className="create-workbook__form" onSubmit={(event) => void submit(event)}>
        <FormField
          id={WORKBOOK_NAME_FIELD_ID}
          label="Workbook name"
          description="Leave empty to use the default name. The workbook starts with a blank Sheet1."
        >
          <input
            id={WORKBOOK_NAME_FIELD_ID}
            type="text"
            value={name}
            placeholder="Untitled workbook"
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : null}
        <div className="form-actions">
          <Button type="submit" variant="primary" disabled={busy}>
            Create
          </Button>
          <a href={makeHash("/")}>Cancel</a>
        </div>
      </form>
    </main>
  );
}

import { useState, type FormEvent } from "react";

import { navigate } from "../lib/hash-route";
import { Button, FormField } from "../ui";
import { createWorkbook, requestErrorMessage } from "../workbooks/api";

export function CreateWorkbookPage() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = "create-workbook-name";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { workbook } = await createWorkbook(name);
      navigate(`/workbooks/${workbook.id}`);
    } catch (caught) {
      setError(requestErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="create">
      <p className="create__nav">
        <a href="#/">All workbooks</a>
      </p>
      <h1 className="create__title">New blank workbook</h1>
      <form className="create__form" onSubmit={(event) => void submit(event)}>
        <FormField
          id={inputId}
          label="Workbook name"
          error={error ?? undefined}
          description="Leave this blank to use a default name."
        >
          <input
            id={inputId}
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
          />
        </FormField>
        <div className="create__actions">
          <Button type="submit" variant="primary" disabled={busy}>
            Create
          </Button>
        </div>
      </form>
    </main>
  );
}

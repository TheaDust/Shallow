import { useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";
import { navigate } from "../lib/hash-route";
import { createWorkbook, errorMessage } from "../lib/workbooks-api";

export function NewWorkbookPage() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const trimmed = name.trim();
    try {
      const workbook = await createWorkbook(trimmed.length > 0 ? trimmed : undefined);
      navigate(`/workbooks/${encodeURIComponent(workbook.id)}`);
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  };

  return (
    <main>
      <header className="page-header">
        <h1>New workbook</h1>
      </header>
      <form className="create-workbook-form" onSubmit={submit}>
        <FormField id="new-workbook-name" label="Workbook name" description="Leave blank to use a default name.">
          <input
            id="new-workbook-name"
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="form-actions">
          <Button type="submit" variant="primary" disabled={busy}>Create</Button>
          <a href="#/">Home</a>
        </div>
      </form>
    </main>
  );
}

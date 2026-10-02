import { useState, type FormEvent } from "react";

import { createWorkbook } from "../api/workbooks";
import { makeHash, navigate } from "../lib/hash-route";
import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";

export function NewWorkbookPage() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { workbook } = await createWorkbook(name.trim());
      navigate(`/workbooks/${workbook.id}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to create workbook");
      setSubmitting(false);
    }
  }

  return (
    <main>
      <header className="page-header">
        <h1>Create workbook</h1>
      </header>

      <form className="stacked-form" aria-label="Create workbook" onSubmit={handleSubmit}>
        <FormField id="new-workbook-name" label="Workbook name">
          <input
            id="new-workbook-name"
            name="workbook-name"
            type="text"
            value={name}
            placeholder="Untitled spreadsheet"
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <div className="form-actions">
          <Button type="submit" variant="primary" disabled={submitting}>
            Create
          </Button>
          <a href={makeHash("/")}>Back to workbooks</a>
        </div>
      </form>

      {submitting ? <p role="status">Creating workbook…</p> : null}
      {error ? (
        <p role="alert" className="page-error">
          {error}
        </p>
      ) : null}
    </main>
  );
}

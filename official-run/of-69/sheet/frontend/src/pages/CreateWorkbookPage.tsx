import { useState, type FormEvent } from "react";

import { ApiError } from "../lib/api";
import { navigate } from "../lib/hash-route";
import { createBlankWorkbook } from "../domain/workbook-api";
import { Button, FormField } from "../ui";

export function CreateWorkbookPage() {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const workbook = await createBlankWorkbook(name);
      navigate(`/workbooks/${workbook.id}`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to create the workbook. Please try again.");
      setSaving(false);
    }
  }

  return (
    <main className="create-workbook">
      <a className="page-home-link" href="#/">
        Home
      </a>
      <h1>New workbook</h1>
      <form className="create-workbook__form" aria-label="Create workbook" onSubmit={submit}>
        <FormField
          id="new-workbook-name"
          label="Workbook name"
          error={error || undefined}
          description="Leave empty to start with the default name."
        >
          <input
            id="new-workbook-name"
            type="text"
            value={name}
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              setName(event.target.value);
              if (error) setError("");
            }}
          />
        </FormField>
        <Button variant="primary" type="submit" disabled={saving}>
          Create
        </Button>
      </form>
    </main>
  );
}

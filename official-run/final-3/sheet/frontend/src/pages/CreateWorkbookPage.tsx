import { useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";
import { makeHash, navigate } from "../lib/hash-route";
import { createWorkbook } from "../lib/workbook-api";

const NAME_FIELD_ID = "create-workbook-name";

export function CreateWorkbookPage() {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const workbook = await createWorkbook(name);
      navigate(`/workbooks/${workbook.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create workbook");
      setSubmitting(false);
    }
  };

  return (
    <section className="create-workbook" aria-labelledby="create-workbook-heading">
      <nav className="page-nav">
        <a href={makeHash("/")}>Home</a>
      </nav>
      <h1 id="create-workbook-heading">New blank workbook</h1>
      <form className="create-workbook__form" aria-label="New blank workbook" onSubmit={submit}>
        <FormField id={NAME_FIELD_ID} label="Workbook name">
          <input
            id={NAME_FIELD_ID}
            type="text"
            value={name}
            placeholder="Untitled workbook"
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <div className="create-workbook__actions">
          <Button type="submit" variant="primary" disabled={submitting}>
            Create
          </Button>
        </div>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </section>
  );
}

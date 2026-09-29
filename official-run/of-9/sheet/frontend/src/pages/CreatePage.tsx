import { useState, type FormEvent } from "react";

import { createWorkbook } from "../lib/api";
import { makeHash, navigate } from "../lib/hash-route";
import { Button } from "../ui";

export function CreatePage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const workbook = await createWorkbook();
      navigate(`/workbook/${encodeURIComponent(workbook.id)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to create workbook");
      setBusy(false);
    }
  };

  return (
    <main className="create-page">
      <h1>New workbook</h1>
      <form onSubmit={(event) => void submit(event)}>
        <Button type="submit" variant="primary" disabled={busy}>
          Create
        </Button>
      </form>
      {error ? <p role="alert" className="create-page__error">{error}</p> : null}
      <p>
        <a href={makeHash("/")}>Back to workbooks</a>
      </p>
    </main>
  );
}

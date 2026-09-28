import { useState } from "react";

import { navigate } from "../lib/hash-route";
import { createWorkbook, errorMessage } from "../lib/workbooks";

export function CreatePage() {
  const [name, setName] = useState("Untitled workbook");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    const trimmed = name.trim();
    if (trimmed === "") {
      setError("Workbook name cannot be empty");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const workbook = await createWorkbook(trimmed);
      navigate(`/workbooks/${workbook.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main className="create-page">
      <p>
        <a className="home-link" href="#/">
          Back to home
        </a>
      </p>
      <h1>New workbook</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleCreate();
        }}
      >
        <div className="form-field">
          <label htmlFor="new-workbook-name">Workbook name</label>
          <input
            id="new-workbook-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
          />
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Creating…" : "Create"}
        </button>
      </form>
    </main>
  );
}

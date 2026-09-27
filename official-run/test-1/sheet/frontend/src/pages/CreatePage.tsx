import { useState } from "react";
import type { FormEvent } from "react";
import { createWorkbook } from "../api";

export default function CreatePage() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { workbook } = await createWorkbook(name);
      window.location.hash = `#/workbook/${encodeURIComponent(workbook.id)}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create workbook");
      setBusy(false);
    }
  }

  return (
    <main className="create-page">
      <h1>Create workbook</h1>
      <form onSubmit={handleSubmit} className="create-form">
        <div className="field">
          <label htmlFor="create-workbook-name">Workbook name</label>
          <input
            id="create-workbook-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy}>
          Create
        </button>
      </form>
    </main>
  );
}

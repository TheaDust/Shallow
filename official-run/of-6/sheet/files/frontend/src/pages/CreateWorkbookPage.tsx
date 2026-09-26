import { useState } from 'react';
import type { FormEvent } from 'react';
import { createWorkbook } from '../api';

const DEFAULT_NAME = 'Untitled workbook';

export default function CreateWorkbookPage() {
  const [name, setName] = useState(DEFAULT_NAME);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    createWorkbook(name)
      .then((workbook) => {
        window.location.hash = `#/workbook/${encodeURIComponent(workbook.id)}`;
      })
      .catch((err: Error) => {
        setError(err.message);
        setSubmitting(false);
      });
  }

  return (
    <main className="create-page">
      <h1>New workbook</h1>
      <form className="create-form" onSubmit={handleSubmit}>
        <label htmlFor="create-workbook-name">Workbook name</label>
        <input
          id="create-workbook-name"
          className="create-name-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="create-actions">
          <a className="cancel-link" href="#/">
            Cancel
          </a>
          <button type="submit" className="create-submit" disabled={submitting}>
            Create
          </button>
        </div>
      </form>
    </main>
  );
}

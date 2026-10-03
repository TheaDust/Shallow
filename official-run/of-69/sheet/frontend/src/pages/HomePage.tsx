import { useEffect, useState } from "react";

import { ApiError } from "../lib/api";
import { makeHash, navigate } from "../lib/hash-route";
import { fetchWorkbooks } from "../domain/workbook-api";
import { lastUpdatedText, type WorkbookSummary } from "../domain/types";
import { ImportCsvDialog } from "../editor/ImportCsvDialog";
import { Button } from "../ui";

function messageOf(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : "Unable to load workbooks. Please try again.";
}

export function HomePage() {
  const [workbooks, setWorkbooks] = useState<WorkbookSummary[] | null>(null);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setWorkbooks(null);
    setError("");
    fetchWorkbooks()
      .then((list) => {
        if (active) setWorkbooks(list);
      })
      .catch((cause) => {
        if (active) setError(messageOf(cause));
      });
    return () => {
      active = false;
    };
  }, [reloadToken]);

  return (
    <main className="home">
      <h1>Workbooks</h1>
      <p className="home__intro">Open an existing workbook or start a new one.</p>
      <div className="home__actions">
        <Button variant="primary" onClick={() => navigate("/new")}>
          New blank workbook
        </Button>
        <Button onClick={() => setImportOpen(true)}>Import CSV</Button>
      </div>
      {error ? (
        <div className="home__error" role="alert">
          <p>{error}</p>
          <Button onClick={() => setReloadToken((token) => token + 1)}>Retry</Button>
        </div>
      ) : null}
      {!error && workbooks === null ? <p role="status">Loading workbooks…</p> : null}
      {!error && workbooks !== null && workbooks.length === 0 ? (
        <p className="home__empty">No workbooks yet.</p>
      ) : null}
      {workbooks !== null && workbooks.length > 0 ? (
        <ul className="workbook-list">
          {workbooks.map((workbook) => (
            <li className="workbook-list__item" key={workbook.id}>
              <a className="workbook-list__link" href={makeHash(`/workbooks/${encodeURIComponent(workbook.id)}`)}>
                {workbook.name}
              </a>
              <p className="workbook-list__meta">{lastUpdatedText(workbook.updatedAt)}</p>
            </li>
          ))}
        </ul>
      ) : null}
      <ImportCsvDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={(workbook) => {
          setImportOpen(false);
          navigate(`/workbooks/${workbook.id}`);
        }}
      />
    </main>
  );
}

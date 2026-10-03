import { useEffect, useState } from "react";

import { Button } from "../ui/Button";
import { ImportCsvDialog } from "../features/workbooks/ImportCsvDialog";
import { makeHash, navigate } from "../lib/hash-route";
import { errorMessage, listWorkbooks } from "../lib/workbooks-api";
import type { WorkbookSummary } from "../domain/types";

type Status = "loading" | "ready" | "error";

export function HomePage() {
  const [status, setStatus] = useState<Status>("loading");
  const [workbooks, setWorkbooks] = useState<WorkbookSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);
    listWorkbooks()
      .then((loaded) => {
        if (cancelled) return;
        setWorkbooks(loaded);
        setStatus("ready");
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(errorMessage(cause));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <header className="page-header">
        <h1>Workbooks</h1>
        <div className="page-header__actions">
          <Button variant="primary" onClick={() => navigate("/workbooks/new")}>New blank workbook</Button>
          <Button onClick={() => setImporting(true)}>Import CSV</Button>
        </div>
      </header>
      {status === "loading" ? <p role="status">Loading workbooks…</p> : null}
      {status === "error" ? <p role="alert">{error}</p> : null}
      {status === "ready" && workbooks.length === 0 ? (
        <p className="empty-state">No workbooks yet. Create a blank workbook to get started.</p>
      ) : null}
      <ul className="workbook-list">
        {workbooks.map((workbook) => (
          <li key={workbook.id} className="workbook-list__item">
            <a className="workbook-list__link" href={makeHash(`/workbooks/${encodeURIComponent(workbook.id)}`)}>
              {workbook.name}
            </a>
            <p className="workbook-list__meta">Last updated: {workbook.updatedAt}</p>
          </li>
        ))}
      </ul>
      <ImportCsvDialog
        open={importing}
        onClose={() => setImporting(false)}
        onImported={(workbook) => {
          setImporting(false);
          navigate(`/workbooks/${encodeURIComponent(workbook.id)}`);
        }}
      />
    </main>
  );
}

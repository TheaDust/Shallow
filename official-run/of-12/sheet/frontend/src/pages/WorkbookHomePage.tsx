import { useCallback, useEffect, useState } from "react";

import { errorMessage } from "../hooks/useWorkbook";
import { makeHash, navigate } from "../lib/hash-route";
import { listWorkbooks, type WorkbookSummary } from "../lib/workbooks";
import { Button } from "../ui";
import { ImportCsvDialog } from "./ImportCsvDialog";

type HomeStatus = "loading" | "ready" | "error";

export function WorkbookHomePage() {
  const [status, setStatus] = useState<HomeStatus>("loading");
  const [workbooks, setWorkbooks] = useState<WorkbookSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      setWorkbooks(await listWorkbooks());
      setStatus("ready");
    } catch (cause) {
      setError(errorMessage(cause));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="home">
      <header className="home__header">
        <h1 className="home__title">Workbooks</h1>
        <div className="home__actions">
          <Button onClick={() => setImportOpen(true)}>Import CSV</Button>
          <Button variant="primary" onClick={() => navigate("/workbooks/new")}>New blank workbook</Button>
        </div>
      </header>
      {status === "loading" ? <p role="status" className="home__status">Loading workbooks…</p> : null}
      {status === "error" ? (
        <div className="home__error" role="alert">
          <p>{error}</p>
          <Button onClick={() => void load()}>Retry</Button>
        </div>
      ) : null}
      {status === "ready" && workbooks.length === 0 ? (
        <p className="home__empty">No workbooks yet.</p>
      ) : null}
      {workbooks.length > 0 ? (
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
      ) : null}
      <ImportCsvDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(workbook) => {
          setImportOpen(false);
          navigate(`/workbooks/${encodeURIComponent(workbook.id)}`);
        }}
      />
    </main>
  );
}

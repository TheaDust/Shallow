import { useCallback, useEffect, useState } from "react";

import { ImportCsvDialog } from "../components/ImportCsvDialog";
import { formatLastUpdated, workbookRoute, type WorkbookSummary } from "../domain/workbook";
import { makeHash, navigate } from "../lib/hash-route";
import { listWorkbooks } from "../lib/workbook-api";
import { Button } from "../ui/Button";

type Status = "loading" | "ready" | "error";

export function WorkbookHomePage() {
  const [status, setStatus] = useState<Status>("loading");
  const [workbooks, setWorkbooks] = useState<WorkbookSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      setWorkbooks(await listWorkbooks());
      setStatus("ready");
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "Could not load workbooks.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="home">
      <header className="home__header">
        <h1>Workbooks</h1>
        <div className="home__actions">
          <Button variant="primary" onClick={() => navigate("/new")}>New blank workbook</Button>
          <Button onClick={() => setImportOpen(true)}>Import CSV</Button>
        </div>
      </header>

      {status === "loading" ? <p role="status">Loading workbooks…</p> : null}

      {status === "error" ? (
        <div className="home__error">
          <p role="alert">{error}</p>
          <Button onClick={() => void load()}>Retry</Button>
        </div>
      ) : null}

      {status === "ready" && workbooks.length === 0 ? (
        <p className="home__empty">No workbooks yet.</p>
      ) : null}

      {status === "ready" && workbooks.length > 0 ? (
        <ul className="workbook-list">
          {workbooks.map((workbook) => (
            <li key={workbook.id} className="workbook-list__item">
              <a className="workbook-list__link" href={makeHash(workbookRoute(workbook.id))}>
                {workbook.name}
              </a>
              <p className="workbook-list__updated">Last updated: {formatLastUpdated(workbook.updatedAt)}</p>
            </li>
          ))}
        </ul>
      ) : null}

      <ImportCsvDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={(workbook) => {
          setImportOpen(false);
          navigate(workbookRoute(workbook.id));
        }}
      />
    </main>
  );
}

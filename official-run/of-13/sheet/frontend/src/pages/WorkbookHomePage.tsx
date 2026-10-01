import { useCallback, useEffect, useState } from "react";

import { fetchWorkbooks } from "../api/workbooks";
import { ImportCsvDialog } from "../components/ImportCsvDialog";
import type { WorkbookSummary } from "../domain/workbook";
import { makeHash, navigate } from "../lib/hash-route";
import { formatUpdatedAt } from "../lib/format";
import { Button } from "../ui/Button";

type LoadState = "loading" | "ready" | "error";

export function WorkbookHomePage() {
  const [state, setState] = useState<LoadState>("loading");
  const [workbooks, setWorkbooks] = useState<WorkbookSummary[]>([]);
  const [error, setError] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const result = await fetchWorkbooks();
      setWorkbooks(result.workbooks);
      setState("ready");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to load workbooks");
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main>
      <header className="page-header">
        <h1>Workbooks</h1>
        <div className="page-header__actions">
          <Button onClick={() => setImportOpen(true)}>Import CSV</Button>
          <Button variant="primary" onClick={() => navigate("/workbooks/new")}>
            New blank workbook
          </Button>
        </div>
      </header>

      {state === "loading" ? <p role="status">Loading workbooks…</p> : null}

      {state === "error" ? (
        <p role="alert" className="page-error">
          {error}{" "}
          <Button onClick={() => void load()}>Retry</Button>
        </p>
      ) : null}

      {state === "ready" && workbooks.length === 0 ? <p>No workbooks yet.</p> : null}

      {state === "ready" && workbooks.length > 0 ? (
        <ul className="workbook-list">
          {workbooks.map((workbook) => (
            <li key={workbook.id} className="workbook-list__item">
              <a className="workbook-list__link" href={makeHash(`/workbooks/${workbook.id}`)}>
                {workbook.name}
              </a>
              <p className="workbook-list__meta">Last updated: {formatUpdatedAt(workbook.updatedAt)}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {importOpen ? (
        <ImportCsvDialog onClose={() => setImportOpen(false)} />
      ) : null}
    </main>
  );
}

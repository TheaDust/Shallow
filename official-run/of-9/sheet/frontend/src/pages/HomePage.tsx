import { useCallback, useEffect, useState } from "react";

import type { WorkbookSummary } from "../domain/types";
import { formatUpdated } from "../domain/grid";
import { listWorkbooks } from "../lib/api";
import { makeHash, navigate } from "../lib/hash-route";
import { Button } from "../ui";
import { ImportCsvDialog } from "../components/ImportCsvDialog";

export function HomePage() {
  const [workbooks, setWorkbooks] = useState<WorkbookSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setWorkbooks(await listWorkbooks());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load workbooks");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="home-page">
      <h1>Workbooks</h1>
      <div className="home-page__actions">
        <Button variant="primary" onClick={() => navigate("/new")}>
          New blank workbook
        </Button>
        <Button onClick={() => setImportOpen(true)}>Import CSV</Button>
      </div>
      {busy ? (
        <p role="status">Loading workbooks…</p>
      ) : error ? (
        <p role="alert" className="home-page__error">
          {error}{" "}
          <Button variant="ghost" onClick={() => void load()}>
            Retry
          </Button>
        </p>
      ) : workbooks.length === 0 ? (
        <p>No workbooks yet.</p>
      ) : (
        <ul className="workbook-list">
          {workbooks.map((workbook) => (
            <li key={workbook.id} className="workbook-record">
              <a className="workbook-record__link" href={makeHash(`/workbook/${encodeURIComponent(workbook.id)}`)}>
                {workbook.name}
              </a>
              <span className="workbook-record__updated">Last updated: {formatUpdated(workbook.updatedAt)}</span>
            </li>
          ))}
        </ul>
      )}
      <ImportCsvDialog open={importOpen} onOpenChange={setImportOpen} />
    </main>
  );
}

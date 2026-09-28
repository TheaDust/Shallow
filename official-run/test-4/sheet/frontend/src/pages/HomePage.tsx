import { useEffect, useState } from "react";

import { ImportDialog } from "../components/ImportDialog";
import { formatDateTime } from "../lib/spreadsheet";
import { navigate } from "../lib/hash-route";
import { errorMessage, listWorkbooks, type WorkbookSummary } from "../lib/workbooks";

export function HomePage() {
  const [workbooks, setWorkbooks] = useState<WorkbookSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setLoadError(null);
    listWorkbooks()
      .then((loaded) => {
        if (!cancelled) {
          setWorkbooks(loaded);
          setBusy(false);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(errorMessage(error));
          setBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="home-page">
      <h1>Workbooks</h1>
      <div className="home-actions">
        <button type="button" className="primary" onClick={() => navigate("/new")}>
          New blank workbook
        </button>
        <button type="button" onClick={() => setImportOpen(true)}>
          Import CSV
        </button>
      </div>
      {busy && (
        <p role="status" className="busy">
          Loading workbooks…
        </p>
      )}
      {loadError && (
        <p role="alert" className="form-error">
          {loadError}
        </p>
      )}
      {!busy && !loadError && workbooks.length === 0 && <p>No workbooks yet.</p>}
      {!busy && !loadError && workbooks.length > 0 && (
        <ul className="workbook-list">
          {workbooks.map((workbook) => (
            <li key={workbook.id}>
              <article className="workbook-record">
                <a className="workbook-link" href={`#/workbooks/${workbook.id}`}>
                  {workbook.name}
                </a>
                <span className="workbook-updated">
                  Last updated: {formatDateTime(workbook.updatedAt)}
                </span>
              </article>
            </li>
          ))}
        </ul>
      )}
      {importOpen && (
        <ImportDialog
          onImported={(workbookId) => navigate(`/workbooks/${workbookId}`)}
          onClose={() => setImportOpen(false)}
        />
      )}
    </main>
  );
}

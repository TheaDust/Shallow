import { useCallback, useEffect, useState } from "react";
import { listWorkbooks } from "../api";
import { formatLastUpdated } from "../format";
import type { WorkbookSummary } from "../types";
import ImportCsvDialog from "../components/ImportCsvDialog";

export default function HomePage() {
  const [workbooks, setWorkbooks] = useState<WorkbookSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    let active = true;
    setError(null);
    listWorkbooks()
      .then(({ workbooks: list }) => {
        if (active) setWorkbooks(list);
      })
      .catch((err: Error) => {
        if (active) {
          setWorkbooks(null);
          setError(err.message || "Failed to load workbooks");
        }
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <main className="home">
      <h1>Workbooks</h1>
      <div className="home-toolbar">
        <button
          type="button"
          onClick={() => {
            window.location.hash = "#/new";
          }}
        >
          New blank workbook
        </button>
        <button type="button" className="ghost" onClick={() => setShowImport(true)}>
          Import CSV
        </button>
        <button type="button" className="ghost" onClick={reload}>
          Refresh
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
          <button type="button" onClick={reload}>
            Try again
          </button>
        </p>
      )}
      {!error && workbooks === null && <p className="status">Loading workbooks…</p>}
      {workbooks !== null && (
        <ul className="workbook-list">
          {workbooks.map((wb) => (
            <li key={wb.id} className="workbook-record">
              <a href={`#/workbook/${encodeURIComponent(wb.id)}`}>{wb.name}</a>
              <span className="updated">Last updated: {formatLastUpdated(wb.updatedAt)}</span>
            </li>
          ))}
        </ul>
      )}
      {showImport && (
        <ImportCsvDialog
          onClose={() => setShowImport(false)}
          onImported={(id) => {
            window.location.hash = `#/workbook/${encodeURIComponent(id)}`;
          }}
        />
      )}
    </main>
  );
}

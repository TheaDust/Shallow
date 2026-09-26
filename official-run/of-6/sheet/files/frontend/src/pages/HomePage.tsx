import { useEffect, useState } from 'react';
import { listWorkbooks } from '../api';
import { formatLastUpdated } from '../gridUtils';
import type { WorkbookSummary } from '../types';
import ImportCsvDialog from '../components/ImportCsvDialog';

export default function HomePage() {
  const [workbooks, setWorkbooks] = useState<WorkbookSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listWorkbooks()
      .then((items) => {
        if (!cancelled) {
          setWorkbooks(items);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="home-page">
      <header className="home-header">
        <h1>Workbooks</h1>
        <div className="home-actions">
          <button
            type="button"
            className="new-workbook-button"
            onClick={() => {
              window.location.hash = '#/new';
            }}
          >
            New blank workbook
          </button>
          <button
            type="button"
            className="import-csv-button"
            onClick={() => setImportOpen(true)}
          >
            Import CSV
          </button>
        </div>
      </header>
      {importOpen && (
        <ImportCsvDialog
          onImported={(workbook) => {
            window.location.hash = `#/workbook/${encodeURIComponent(workbook.id)}`;
          }}
          onClose={() => setImportOpen(false)}
        />
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button
            type="button"
            className="retry-button"
            onClick={() => {
              setError(null);
              setWorkbooks(null);
              listWorkbooks()
                .then((items) => setWorkbooks(items))
                .catch((err: Error) => setError(err.message));
            }}
          >
            Retry
          </button>
        </div>
      )}
      {!error && workbooks === null && (
        <p className="loading-text" role="status">
          Loading workbooks…
        </p>
      )}
      {workbooks && (
        <section aria-label="Workbook list" className="workbook-list">
          {workbooks.length === 0 ? (
            <p>No workbooks yet.</p>
          ) : (
            <ul>
              {workbooks.map((wb) => (
                <li key={wb.id}>
                  <article className="workbook-card">
                    <a href={`#/workbook/${encodeURIComponent(wb.id)}`}>{wb.name}</a>
                    <p>Last updated: {formatLastUpdated(wb.lastUpdated)}</p>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}

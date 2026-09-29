import { useCallback, useEffect, useState } from "react";

import { Button } from "../../ui";
import { makeHash, navigate } from "../../lib/hash-route";
import { errorMessage, listWorkbooks } from "./api";
import { formatLastUpdated } from "./format";
import { ImportCsvDialog } from "./ImportCsvDialog";
import type { WorkbookSummary } from "./types";

type ListState =
  | { status: "loading" }
  | { status: "ready"; workbooks: WorkbookSummary[] }
  | { status: "error"; message: string };

export function WorkbookHomePage() {
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const { workbooks } = await listWorkbooks();
      setState({ status: "ready", workbooks });
    } catch (error) {
      setState({ status: "error", message: errorMessage(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="home">
      <header className="home__header">
        <h1>Workbooks</h1>
        <p className="home__subtitle">Open an existing workbook, create a blank one, or import CSV data.</p>
      </header>
      <div className="home__actions">
        <Button variant="primary" onClick={() => navigate("/workbooks/new")}>
          New blank workbook
        </Button>
        <Button onClick={() => setImportOpen(true)}>Import CSV</Button>
      </div>
      <section aria-label="Workbooks" className="home__list">
        {state.status === "loading" ? <p role="status">Loading workbooks…</p> : null}
        {state.status === "error" ? (
          <div className="home__error">
            <p role="alert">{state.message}</p>
            <Button onClick={() => void load()}>Retry</Button>
          </div>
        ) : null}
        {state.status === "ready" && state.workbooks.length === 0 ? <p>No workbooks yet.</p> : null}
        {state.status === "ready" && state.workbooks.length > 0 ? (
          <ul className="workbook-list">
            {state.workbooks.map((workbook) => (
              <li key={workbook.id}>
                <article className="workbook-card">
                  <a className="workbook-card__link" href={makeHash(`/workbooks/${workbook.id}`)}>
                    {workbook.name}
                  </a>
                  <p className="workbook-card__meta">Last updated: {formatLastUpdated(workbook.updatedAt)}</p>
                </article>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
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

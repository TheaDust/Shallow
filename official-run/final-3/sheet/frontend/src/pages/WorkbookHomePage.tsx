import { useEffect, useState } from "react";

import { Button } from "../ui/Button";
import { ImportCsvDialog } from "../components/ImportCsvDialog";
import { makeHash, navigate } from "../lib/hash-route";
import { fetchWorkbooks } from "../lib/workbook-api";
import { formatLastUpdated } from "../domain/grid";
import type { WorkbookSummary } from "../domain/types";

type HomeState =
  | { status: "loading" }
  | { status: "ready"; workbooks: WorkbookSummary[] }
  | { status: "error"; message: string };

export function WorkbookHomePage() {
  const [state, setState] = useState<HomeState>({ status: "loading" });
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    fetchWorkbooks()
      .then((workbooks) => {
        if (active) setState({ status: "ready", workbooks });
      })
      .catch((error: unknown) => {
        if (active) {
          setState({ status: "error", message: error instanceof Error ? error.message : "Unable to load workbooks" });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <header className="page-header">
        <h1>Workbooks</h1>
        <div className="page-header__actions">
          <Button variant="primary" onClick={() => navigate("/workbooks/new")}>
            New blank workbook
          </Button>
          <Button onClick={() => setImportOpen(true)}>Import CSV</Button>
        </div>
      </header>
      {state.status === "loading" ? <p role="status">Loading workbooks…</p> : null}
      {state.status === "error" ? <p role="alert">{state.message}</p> : null}
      {state.status === "ready" && state.workbooks.length === 0 ? (
        <p className="empty-state">No workbooks yet. Create a blank workbook to get started.</p>
      ) : null}
      {state.status === "ready" && state.workbooks.length > 0 ? (
        <ul className="workbook-list" aria-label="Workbooks">
          {state.workbooks.map((workbook) => (
            <li key={workbook.id} className="workbook-card">
              <a className="workbook-card__name" href={makeHash(`/workbooks/${workbook.id}`)}>
                {workbook.name}
              </a>
              <p className="workbook-card__updated">{formatLastUpdated(workbook.updatedAt)}</p>
            </li>
          ))}
        </ul>
      ) : null}
      <ImportCsvDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={(workbook) => navigate(`/workbooks/${workbook.id}`)}
      />
    </>
  );
}

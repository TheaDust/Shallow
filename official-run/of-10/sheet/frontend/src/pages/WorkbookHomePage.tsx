import { useCallback, useEffect, useState } from "react";

import { navigate } from "../lib/hash-route";
import { Button } from "../ui";
import { ImportCsvDialog } from "../workbooks/ImportCsvDialog";
import { listWorkbooks, requestErrorMessage } from "../workbooks/api";
import { formatLastUpdated } from "../workbooks/format";
import type { WorkbookSummary } from "../workbooks/types";

type HomeState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; workbooks: WorkbookSummary[] };

export function WorkbookHomePage() {
  const [state, setState] = useState<HomeState>({ status: "loading" });
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(() => {
    setState({ status: "loading" });
    listWorkbooks()
      .then((workbooks) => setState({ status: "ready", workbooks }))
      .catch((error) => setState({ status: "error", message: requestErrorMessage(error) }));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="home">
      <h1 className="home__title">Workbooks</h1>
      <div className="home__actions">
        <Button variant="primary" onClick={() => navigate("/workbooks/new")}>
          New blank workbook
        </Button>
        <Button onClick={() => setImportOpen(true)}>Import CSV</Button>
      </div>
      {state.status === "loading" ? (
        <p role="status">Loading workbooks…</p>
      ) : state.status === "error" ? (
        <p role="alert">{state.message}</p>
      ) : state.workbooks.length === 0 ? (
        <p className="home__empty">No workbooks yet.</p>
      ) : (
        <ul className="home__list">
          {state.workbooks.map((workbook) => (
            <li key={workbook.id} className="workbook-record">
              <a className="workbook-record__link" href={`#/workbooks/${workbook.id}`}>
                {workbook.name}
              </a>
              <p className="workbook-record__updated">Last updated: {formatLastUpdated(workbook.updatedAt)}</p>
            </li>
          ))}
        </ul>
      )}
      <ImportCsvDialog open={importOpen} onOpenChange={setImportOpen} />
    </main>
  );
}

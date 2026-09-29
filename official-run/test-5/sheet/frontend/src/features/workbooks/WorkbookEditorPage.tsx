import { useCallback, useEffect, useState } from "react";

import { Button } from "../../ui";
import { makeHash } from "../../lib/hash-route";
import { errorMessage, getWorkbook } from "./api";
import type { WorkbookData } from "./types";
import { WorkbookEditorView } from "./WorkbookEditorView";

type EditorState =
  | { status: "loading" }
  | { status: "ready"; workbook: WorkbookData }
  | { status: "error"; message: string };

export interface WorkbookEditorPageProps {
  workbookId: string;
}

export function WorkbookEditorPage({ workbookId }: WorkbookEditorPageProps) {
  const [state, setState] = useState<EditorState>({ status: "loading" });
  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const { workbook } = await getWorkbook(workbookId);
      setState({ status: "ready", workbook });
    } catch (error) {
      setState({ status: "error", message: errorMessage(error) });
    }
  }, [workbookId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === "loading") {
    return (
      <main className="editor">
        <p role="status">Loading workbook…</p>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="editor">
        <h1>Workbook unavailable</h1>
        <p role="alert">{state.message}</p>
        <div className="form-actions">
          <Button onClick={() => void load()}>Retry</Button>
          <a href={makeHash("/")}>All workbooks</a>
        </div>
      </main>
    );
  }

  return (
    <WorkbookEditorView
      workbook={state.workbook}
      onWorkbookChange={(workbook) => setState({ status: "ready", workbook })}
    />
  );
}

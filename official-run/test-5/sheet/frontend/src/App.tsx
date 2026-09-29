import { useHashLocation } from "./lib/hash-route";
import { CreateWorkbookPage } from "./features/workbooks/CreateWorkbookPage";
import { WorkbookEditorPage } from "./features/workbooks/WorkbookEditorPage";
import { WorkbookHomePage } from "./features/workbooks/WorkbookHomePage";

export function App() {
  const { path } = useHashLocation();
  const raw = path.replace(/\/+$/, "") || "/";
  const editorMatch = /^\/workbooks\/([^/]+)$/.exec(raw);

  if (raw === "/workbooks/new") return <CreateWorkbookPage />;
  if (editorMatch) return <WorkbookEditorPage workbookId={decodeURIComponent(editorMatch[1])} />;
  return <WorkbookHomePage />;
}

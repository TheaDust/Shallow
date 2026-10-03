import { useHashLocation } from "./lib/hash-route";
import { HomePage } from "./pages/HomePage";
import { NewWorkbookPage } from "./pages/NewWorkbookPage";
import { WorkbookEditorPage } from "./pages/WorkbookEditorPage";

const WORKBOOK_PATH = /^\/workbooks\/([^/]+)$/;

export function App() {
  const { path } = useHashLocation();

  if (path === "/workbooks/new") return <NewWorkbookPage />;

  const workbookMatch = path.match(WORKBOOK_PATH);
  if (workbookMatch) {
    return <WorkbookEditorPage workbookId={decodeURIComponent(workbookMatch[1])} />;
  }

  return <HomePage />;
}

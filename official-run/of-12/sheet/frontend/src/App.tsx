import { makeHash, useHashLocation } from "./lib/hash-route";
import { NewWorkbookPage } from "./pages/NewWorkbookPage";
import { WorkbookEditorPage } from "./pages/WorkbookEditorPage";
import { WorkbookHomePage } from "./pages/WorkbookHomePage";

const WORKBOOK_PATH = /^\/workbooks\/([^/]+)$/;

export function App() {
  const location = useHashLocation();
  const workbookMatch = WORKBOOK_PATH.exec(location.path);

  if (location.path === "/" || location.path === "") return <WorkbookHomePage />;
  if (location.path === "/workbooks/new") return <NewWorkbookPage />;
  if (workbookMatch) return <WorkbookEditorPage workbookId={decodeURIComponent(workbookMatch[1])} />;

  return (
    <main>
      <h1>Page not found</h1>
      <p><a href={makeHash("/")}>Back to workbooks</a></p>
    </main>
  );
}

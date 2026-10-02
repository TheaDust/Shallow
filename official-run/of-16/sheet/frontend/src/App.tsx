import { WorkbookEditorPage } from "./pages/WorkbookEditorPage";
import { WorkbookHomePage } from "./pages/WorkbookHomePage";
import { NewWorkbookPage } from "./pages/NewWorkbookPage";
import { useHashLocation } from "./lib/hash-route";

const WORKBOOK_ROUTE = /^\/workbooks\/([^/]+)\/?$/;

export function App() {
  const { path, search } = useHashLocation();

  if (path === "/") return <WorkbookHomePage />;
  if (path === "/new") return <NewWorkbookPage />;

  const match = WORKBOOK_ROUTE.exec(path);
  if (match) {
    let id = match[1];
    try {
      id = decodeURIComponent(id);
    } catch {
      // Keep the raw identifier; the API will report it as unknown.
    }
    // `#/workbooks/<id>?new=1&name=<name>` marks a creation started from the
    // creation page; the editor creates the workbook for that id if missing.
    const pendingCreateName = search.get("new") === "1" ? search.get("name") ?? "" : null;
    return <WorkbookEditorPage key={id} workbookId={id} pendingCreateName={pendingCreateName} />;
  }

  return (
    <main>
      <h1>Page not found</h1>
      <p>The page you requested does not exist.</p>
      <p><a href="#/">Back to workbooks</a></p>
    </main>
  );
}

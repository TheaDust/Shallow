import { NewWorkbookPage } from "./pages/NewWorkbookPage";
import { WorkbookEditorPage } from "./pages/WorkbookEditorPage";
import { WorkbookHomePage } from "./pages/WorkbookHomePage";
import { makeHash, useHashLocation } from "./lib/hash-route";

export function App() {
  const location = useHashLocation();
  const editorMatch = /^\/workbooks\/([^/]+)$/.exec(location.path);

  if (location.path === "/workbooks/new") {
    return <NewWorkbookPage />;
  }
  if (editorMatch) {
    return <WorkbookEditorPage workbookId={decodeURIComponent(editorMatch[1])} />;
  }
  if (location.path === "/" || location.path === "") {
    return <WorkbookHomePage />;
  }

  return (
    <main>
      <h1>Page not found</h1>
      <p>The page you requested does not exist.</p>
      <p>
        <a href={makeHash("/")}>Back to workbooks</a>
      </p>
    </main>
  );
}

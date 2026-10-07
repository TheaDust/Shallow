import { useHashLocation } from "./lib/hash-route";
import { WorkbookHomePage } from "./pages/WorkbookHomePage";
import { CreateWorkbookPage } from "./pages/CreateWorkbookPage";
import { WorkbookEditorPage } from "./pages/WorkbookEditorPage";

function NotFoundPage() {
  return (
    <>
      <h1>Page not found</h1>
      <a href="#/">Home</a>
    </>
  );
}

export function App() {
  const location = useHashLocation();
  const path = location.path;

  let page = <NotFoundPage />;
  if (path === "/" || path === "") {
    page = <WorkbookHomePage />;
  } else if (path === "/workbooks/new") {
    page = <CreateWorkbookPage />;
  } else {
    const match = /^\/workbooks\/([^/]+)$/.exec(path);
    if (match) {
      const workbookId = decodeURIComponent(match[1]);
      page = <WorkbookEditorPage key={workbookId} workbookId={workbookId} />;
    }
  }

  return <main>{page}</main>;
}

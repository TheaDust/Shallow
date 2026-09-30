import { useHashLocation } from "./lib/hash-route";
import { CreateWorkbookPage } from "./pages/CreateWorkbookPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { WorkbookEditorPage } from "./pages/WorkbookEditorPage";
import { WorkbookHomePage } from "./pages/WorkbookHomePage";

function decodeSegments(path: string): string[] {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

export function App() {
  const { path } = useHashLocation();
  const segments = decodeSegments(path);

  if (segments.length === 0) return <WorkbookHomePage />;
  if (segments[0] === "workbooks" && segments.length === 2) {
    if (segments[1] === "new") return <CreateWorkbookPage />;
    return <WorkbookEditorPage workbookId={segments[1]} />;
  }
  return <NotFoundPage />;
}

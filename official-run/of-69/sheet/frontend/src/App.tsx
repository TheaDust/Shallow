import { useHashLocation } from "./lib/hash-route";
import { CreateWorkbookPage } from "./pages/CreateWorkbookPage";
import { EditorPage } from "./pages/EditorPage";
import { HomePage } from "./pages/HomePage";
import { NotFoundPage } from "./pages/NotFoundPage";

export function App() {
  const location = useHashLocation();
  const segments = location.path.split("/").filter(Boolean);

  if (segments.length === 0) {
    return <HomePage />;
  }
  if (segments.length === 1 && segments[0] === "new") {
    return <CreateWorkbookPage />;
  }
  if (segments.length === 2 && segments[0] === "workbooks") {
    const workbookId = decodeURIComponent(segments[1]);
    return <EditorPage key={workbookId} workbookId={workbookId} />;
  }
  return <NotFoundPage />;
}

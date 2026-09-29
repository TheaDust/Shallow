import { useHashLocation } from "./lib/hash-route";
import { CreatePage } from "./pages/CreatePage";
import { EditorPage } from "./pages/EditorPage";
import { HomePage } from "./pages/HomePage";

export function App() {
  const location = useHashLocation();
  const path = location.path;

  if (path === "/new") return <CreatePage />;

  const editorMatch = path.match(/^\/workbook\/([^/]+)$/);
  if (editorMatch) return <EditorPage workbookId={decodeURIComponent(editorMatch[1])} />;

  return <HomePage />;
}

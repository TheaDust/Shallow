import { useHashLocation } from "./lib/hash-route";
import { CreatePage } from "./pages/CreatePage";
import { EditorPage } from "./pages/EditorPage";
import { HomePage } from "./pages/HomePage";

export function App() {
  const { path } = useHashLocation();

  if (path === "/new") {
    return <CreatePage />;
  }
  const match = /^\/workbooks\/([^/]+)$/.exec(path);
  if (match) {
    return <EditorPage workbookId={decodeURIComponent(match[1])} />;
  }
  return <HomePage />;
}

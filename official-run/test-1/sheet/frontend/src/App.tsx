import { useEffect, useState } from "react";
import HomePage from "./pages/HomePage";
import CreatePage from "./pages/CreatePage";
import EditorPage from "./pages/EditorPage";
import NotFoundPage from "./pages/NotFoundPage";

export interface Route {
  name: string;
  params: Record<string, string>;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, "") || "/";
  const segments = raw.split("/").filter(Boolean);
  if (segments.length === 0) return { name: "home", params: {} };
  if (segments[0] === "new") return { name: "create", params: {} };
  if (segments[0] === "workbook" && segments[1]) {
    return { name: "editor", params: { id: decodeURIComponent(segments[1]) } };
  }
  return { name: "not-found", params: {} };
}

export default function App() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const route = parseHash(hash);

  let page: React.ReactNode;
  if (route.name === "home") page = <HomePage />;
  else if (route.name === "create") page = <CreatePage />;
  else if (route.name === "editor") page = <EditorPage id={route.params.id} />;
  else page = <NotFoundPage />;

  return (
    <div className="app">
      <header className="app-bar">
        <a className="brand" href="#/">
          Spreadsheet
        </a>
      </header>
      {page}
    </div>
  );
}

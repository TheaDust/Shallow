import { useEffect, useState } from "react";

import { navigate, useHashLocation } from "../lib/hash-route";
import { repositoryScopeFromPath } from "../features/repositories/repository-scope";

/** Result-type and filter parameters a results page keeps while typing. */
const CARRIED_PARAMS = ["type", "repo", "path", "language"];

/**
 * The single search control of the application header (REQ-3-1, REQ-4-2-3).
 *
 * It is a searchbox named "Search" at the top of every page. On a repository
 * address it searches the code of that repository, so the box at the top of a
 * repository page is the entry to its code search; everywhere else it shows
 * repository results directly after Enter. On a results page the box stays in
 * step with the query and keeps the current result type and repository scope,
 * so clearing the term also clears the visible results.
 */
export function SearchBox() {
  const { path, search } = useHashLocation();
  const onResultsPage = path === "/search";
  const urlQuery = onResultsPage ? search.get("q") ?? "" : "";
  const [value, setValue] = useState(urlQuery);

  useEffect(() => {
    setValue(urlQuery);
  }, [urlQuery]);

  function submit(next: string) {
    const trimmed = next.trim();
    const params = new URLSearchParams();
    if (trimmed) params.set("q", trimmed);
    if (onResultsPage) {
      for (const key of CARRIED_PARAMS) {
        const current = search.get(key);
        if (current) params.set(key, current);
      }
      if (!params.has("type")) params.set("type", "repositories");
    } else {
      const repository = repositoryScopeFromPath(path);
      if (repository) {
        params.set("type", "code");
        params.set("repo", `${repository.owner}/${repository.name}`);
      } else {
        params.set("type", "repositories");
      }
    }
    navigate("/search", params);
  }

  return (
    <form
      role="search"
      className="app-header__search"
      onSubmit={(event) => {
        event.preventDefault();
        submit(value);
      }}
    >
      <input
        className="app-header__search-input"
        type="search"
        name="q"
        aria-label="Search"
        placeholder="Search repositories…"
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          if (onResultsPage) submit(next);
        }}
      />
    </form>
  );
}

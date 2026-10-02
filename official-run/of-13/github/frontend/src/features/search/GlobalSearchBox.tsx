import { useEffect, useState } from "react";

import { makeHash, useHashLocation } from "../../lib/hash-route";
import {
  repositoryCodeSearchHref,
  repositoryPath,
  repositoryScopeFromPath,
} from "../../lib/repository-code-api";
import { DEFAULT_SEARCH_TYPE } from "../../lib/search-api";

/**
 * The top search control. Its single input is a searchbox named "Search";
 * pressing Enter opens a results page, so no type filter has to be selected
 * first. Inside a repository the same box searches that repository's code, so
 * a repository page never exposes two search boxes named "Search". The field
 * mirrors the active query so clearing it on the results page is possible.
 */
export function GlobalSearchBox() {
  const location = useHashLocation();
  const scope = repositoryScopeFromPath(location.path);
  const repositorySearchPath = scope
    ? `${repositoryPath(scope.owner, scope.name)}/search`
    : null;
  const onResultsPage = scope ? location.path === repositorySearchPath : location.path === "/search";
  const activeQuery = onResultsPage ? location.search.get("q") ?? "" : "";
  const [value, setValue] = useState(activeQuery);

  useEffect(() => {
    setValue(activeQuery);
  }, [activeQuery]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    window.location.hash = scope
      ? repositoryCodeSearchHref(scope.owner, scope.name, { q: value })
      : makeHash("/search", new URLSearchParams({ q: value, type: DEFAULT_SEARCH_TYPE }));
  }

  return (
    <form className="global-search" role="search" onSubmit={submit}>
      <input
        className="global-search__input"
        type="search"
        name="q"
        aria-label="Search"
        placeholder="Search"
        autoComplete="off"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </form>
  );
}

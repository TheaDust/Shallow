import { useEffect, useState, type FormEvent } from "react";

import { makeHash, useHashLocation } from "../lib/hash-route";
import { REPOSITORY_SEARCH_SUFFIX, matchRepositoryRoute, repositoryPath } from "../repositories/routes";

/** Hash route of the global repository search results page. */
export const SEARCH_PATH = "/search";

/**
 * Top search control of every page. The input keeps the native searchbox role
 * and the stable accessible name "Search"; submitting it (the Enter key)
 * navigates straight to the results, without a separate type filter to click.
 * Inside a repository the same box searches that repository's readable file
 * content, everywhere else it searches repositories, so one control serves both
 * scopes. The field mirrors the `q` of the current search address, so opening a
 * result and coming back keeps the query visible.
 */
export function SearchBox() {
  const location = useHashLocation();
  const repository = matchRepositoryRoute(location.path);
  const activeQuery = location.search.get("q") ?? "";
  const [query, setQuery] = useState(activeQuery);

  useEffect(() => {
    setQuery(activeQuery);
  }, [activeQuery]);

  function resultsHash(value: string): string {
    const params = new URLSearchParams({ q: value });
    if (!repository) return makeHash(SEARCH_PATH, params);
    return makeHash(
      repositoryPath(repository.ownerKind, repository.owner, repository.name, REPOSITORY_SEARCH_SUFFIX),
      params,
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    window.location.hash = resultsHash(trimmed);
  }

  return (
    <form className="app-search" role="search" onSubmit={handleSubmit}>
      <input
        className="app-search__input"
        type="search"
        name="q"
        aria-label="Search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
    </form>
  );
}

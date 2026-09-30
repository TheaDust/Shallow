import { useEffect, useState, type FormEvent } from "react";

import { navigate, useHashLocation } from "../lib/hash-route";
import { repositoryScopeFromPath } from "../lib/repository-routes";

/**
 * Top global search. The control is a searchbox named exactly "Search":
 * entering a repository name and pressing Enter leads straight to repository
 * results, so no further type-filter click is needed. On a repository page the
 * search carries that repository's scope, so its results page can offer the
 * code results of the current repository.
 */
export function GlobalSearch() {
  const location = useHashLocation();
  const onSearchPage = location.path.replace(/\/+$/, "") === "/search";
  const urlQuery = onSearchPage ? location.search.get("q") ?? "" : "";
  const [value, setValue] = useState(urlQuery);

  // The address owns the query, so reloading or returning to the results page
  // shows the same search again.
  useEffect(() => {
    setValue(urlQuery);
  }, [urlQuery]);

  const submitQuery = (next: string) => {
    const params = new URLSearchParams();
    const trimmed = next.trim();
    if (trimmed) params.set("q", trimmed);
    params.set("type", "repositories");
    // A search started on a repository page keeps that repository's scope, and
    // repeating a search on the results page keeps the scope it already has.
    const scope = repositoryScopeFromPath(location.path) ?? location.search.get("repo");
    if (scope) params.set("repo", scope);
    navigate("/search", params);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitQuery(value);
  };

  const handleChange = (next: string) => {
    setValue(next);
    // Clearing the term on the results page must not leave the old results behind.
    if (onSearchPage && next.trim() === "") submitQuery("");
  };

  return (
    <form className="global-search" role="search" onSubmit={handleSubmit}>
      <input
        id="global-search"
        className="global-search__input"
        type="search"
        aria-label="Search"
        placeholder="Search"
        autoComplete="off"
        value={value}
        onChange={(event) => handleChange(event.target.value)}
      />
      <button type="submit" className="global-search__submit" aria-label="Search">
        <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
          <path
            fill="currentColor"
            d="M10.68 11.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06l-3.04-3.04ZM11.5 7a4.5 4.5 0 1 0-9 0 4.5 4.5 0 0 0 9 0Z"
          />
        </svg>
      </button>
    </form>
  );
}

import { useEffect, useState, type FormEvent } from "react";

import { navigate, useHashLocation } from "../lib/hash-route";
import { parseRoute, routeRepository } from "../lib/routes";

/**
 * Top search control: the single searchbox named "Search" on every page.
 * Outside a repository it searches repositories; inside one it is that
 * repository's Search box, so submitting it opens the repository code search
 * results and keeps the query in the address. No extra type-filter click is
 * needed for either scope.
 */
export function GlobalSearch() {
  const location = useHashLocation();
  const route = parseRoute(location.path);
  const repository = routeRepository(route);
  const listsQuery = location.path === "/search" || route.name === "repository-search";
  const urlQuery = listsQuery ? location.search.get("q") ?? "" : null;
  const [value, setValue] = useState(urlQuery ?? "");

  useEffect(() => {
    if (urlQuery !== null) setValue(urlQuery);
  }, [urlQuery]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (repository) {
      navigate(
        `/repositories/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repositoryName)}/search`,
        new URLSearchParams({ q: value }),
      );
      return;
    }
    navigate("/search", new URLSearchParams({ q: value }));
  };

  return (
    <form className="global-search" role="search" onSubmit={submit}>
      <input
        className="global-search__input"
        type="search"
        name="q"
        aria-label="Search"
        placeholder="Search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button className="global-search__submit ui-button" type="submit">
        Search
      </button>
    </form>
  );
}

import { useEffect, useState, type FormEvent } from "react";

import { navigate, useHashLocation } from "../lib/hash-route";
import { repositoryCodeSearchPath, repositoryContextForPath } from "../lib/routes";

export const SEARCH_PATH = "/search";

/**
 * The top search control. It is a native search input (role searchbox) whose
 * accessible name is “Search”; submitting it — pressing Enter is enough —
 * opens the results, so no extra type-filter click is required. Inside a
 * repository the query is scoped to that repository's readable code; anywhere
 * else it searches repositories. On the results page the field shows the query
 * that produced the current results.
 */
export function GlobalSearch() {
  const location = useHashLocation();
  const [value, setValue] = useState(() => location.search.get("q") ?? "");
  const locationKey = `${location.path}?${location.search.toString()}`;

  useEffect(() => {
    setValue(location.search.get("q") ?? "");
  }, [locationKey]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    const query = value.trim();
    if (query) params.set("q", query);
    const repository = repositoryContextForPath(location.path);
    if (repository) {
      // The query is scoped to the directory the Search box belongs to, so the
      // results never mix files of another directory or repository.
      navigate(
        repositoryCodeSearchPath(repository.ownerType, repository.owner, repository.repository, query, {
          branch: location.search.get("branch") ?? undefined,
          path: location.search.get("path") ?? undefined,
        }),
      );
      return;
    }
    navigate(SEARCH_PATH, params);
  }

  return (
    <form className="global-search" role="search" onSubmit={handleSubmit}>
      <input
        className="global-search__input"
        type="search"
        name="q"
        aria-label="Search"
        placeholder="Search repositories"
        autoComplete="off"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </form>
  );
}

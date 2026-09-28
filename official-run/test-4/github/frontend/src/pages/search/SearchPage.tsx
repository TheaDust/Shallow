import { useEffect, useState } from "react";

import { AppHeader } from "../../components/AppHeader";
import { useHashLocation } from "../../lib/hash-route";
import { formatUpdateTime } from "../../lib/org-api";
import { repoHref, RepoDetail, searchRepositories } from "../../lib/repo-api";

type SearchType = "all" | "repositories" | "issues" | "pulls";

/**
 * Global search results page. A repository-name query shows repository
 * results directly; the “Repositories” type filter keeps them, a
 * non-matching filter or an unmatched query shows exactly “No results”.
 */
export function SearchPage() {
  const { search } = useHashLocation();
  const query = search.get("q") ?? "";
  const [type, setType] = useState<SearchType>("all");
  const [results, setResults] = useState<RepoDetail[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResults(null);
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    searchRepositories(trimmed)
      .then((repositories) => {
        if (!cancelled) setResults(repositories);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const showRepositories = type === "all" || type === "repositories";
  const noResults = results !== null && (!showRepositories || results.length === 0);

  return (
    <AppHeader>
      <main>
        <h1>Search results</h1>
        <div className="repo-filter">
          <div className="account-form__field">
            <label htmlFor="search-type">Type</label>
            <select
              id="search-type"
              value={type}
              onChange={(event) => setType(event.target.value as SearchType)}
            >
              <option value="all">All</option>
              <option value="repositories">Repositories</option>
              <option value="issues">Issues</option>
              <option value="pulls">Pull requests</option>
            </select>
          </div>
        </div>
        {results === null ? (
          <p>Loading…</p>
        ) : noResults ? (
          <p>No results</p>
        ) : (
          <ul className="repo-list">
            {results.map((repository) => (
              <li key={`${repository.ownerName}/${repository.name}`} className="repo-list__item">
                <a href={repoHref(repository)}>{repository.name}</a>
                <p className="repo-list__description">
                  {repository.ownerName}/{repository.name}
                </p>
                {repository.description && (
                  <p className="repo-list__description">{repository.description}</p>
                )}
                <p className="repo-list__meta">
                  <span className="repo-list__visibility">
                    {repository.visibility === "public" ? "Public" : "Private"}
                  </span>
                  <span>{formatUpdateTime(repository.updatedAt)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </main>
    </AppHeader>
  );
}

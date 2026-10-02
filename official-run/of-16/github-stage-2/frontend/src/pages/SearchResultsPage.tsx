import { useEffect, useState } from "react";

import { searchRepositories } from "../repositories/api";
import { repositoryPath } from "../repositories/routes";
import type { RepositoryListItem } from "../repositories/types";

export interface SearchResultsPageProps {
  /** The query read from the `q` parameter of the search address. */
  query: string;
}

/**
 * Repository results of the top search box. Every result is one entry whose
 * link carries exactly the repository name as its accessible name, while the
 * owner/name metadata is shown next to it. A query without a readable match
 * shows the empty state ("No repositories" with the "No results" line), and
 * because the query lives in the address, returning home and repeating it
 * performs the same search again.
 */
export function SearchResultsPage({ query }: SearchResultsPageProps) {
  const [repositories, setRepositories] = useState<RepositoryListItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRepositories(null);
    setFailed(false);
    searchRepositories(query)
      .then((next) => {
        if (!cancelled) setRepositories(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  return (
    <section className="page" aria-labelledby="search-results-heading">
      <h1 id="search-results-heading">Search results</h1>
      <p className="page__lead">
        Repositories matching <span className="search-results__query">{query}</span>.
      </p>
      {failed ? (
        <p className="app-form__error" role="alert">
          We could not search the repositories. Try again.
        </p>
      ) : null}
      {!failed && repositories === null ? <p role="status">Searching repositories…</p> : null}
      {repositories !== null ? (
        repositories.length > 0 ? (
          <ul className="search-results">
            {repositories.map((repository) => (
              <li
                key={`${repository.owner.kind}:${repository.owner.slug}/${repository.name}`}
                className="search-results__item"
              >
                <a
                  className="search-results__name"
                  href={`#${repositoryPath(repository.owner.kind, repository.owner.slug, repository.name)}`}
                >
                  {repository.name}
                </a>
                <span className="search-results__owner">
                  {repository.owner.name}/{repository.name}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="search-results__empty">
            <p className="search-results__empty-title">No repositories</p>
            <p className="search-results__empty-detail">No results</p>
          </div>
        )
      ) : null}
    </section>
  );
}

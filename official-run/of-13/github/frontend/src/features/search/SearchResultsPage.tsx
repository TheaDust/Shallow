import { useEffect, useState } from "react";

import { useDocumentTitle } from "../../lib/document-title";
import { repositoryHref } from "../../lib/repository-code-api";
import {
  normalizeSearchType,
  searchHref,
  searchRepositories,
  SEARCH_TYPE_OPTIONS,
  type RepositorySearchResult,
  type SearchType,
} from "../../lib/search-api";
import { formatUpdatedAt, visibilityLabel } from "../organizations/format";

export interface SearchResultsPageProps {
  query: string;
  type: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; results: RepositorySearchResult[] }
  | { status: "error" };

/**
 * Global search results. The server only returns repositories the current
 * viewer may read, so an unauthorized private repository never appears here
 * even when the query matches its name.
 */
export function SearchResultsPage({ query, type }: SearchResultsPageProps) {
  const searchType: SearchType = normalizeSearchType(type);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useDocumentTitle("Search");

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    searchRepositories(query, searchType)
      .then((payload) => {
        if (!cancelled) setState({ status: "ready", results: payload.results });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [query, searchType]);

  const results = state.status === "ready" ? state.results : [];

  return (
    <div className="search-results">
      <h1>Search results</h1>
      <nav className="search-results__types" aria-label="Search types">
        <ul>
          {SEARCH_TYPE_OPTIONS.map((option) => (
            <li key={option.type}>
              <a
                href={searchHref(query, option.type)}
                aria-current={option.type === searchType ? "page" : undefined}
              >
                {option.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {state.status === "loading" ? <p role="status">Loading…</p> : null}
      {state.status === "error" ? (
        <p role="alert">Search is temporarily unavailable. Try again.</p>
      ) : null}
      {state.status === "ready" && results.length === 0 ? (
        <p role="status">No results</p>
      ) : null}
      {results.length > 0 ? (
        <ul className="search-results__list">
          {results.map((result) => (
            <li key={`${result.owner}/${result.name}`}>
              <article className="search-result">
                <h2 className="search-result__name">
                  <a href={repositoryHref(result.owner, result.name)}>{result.name}</a>
                </h2>
                <p className="search-result__owner">{`${result.owner}/${result.name}`}</p>
                {result.description ? (
                  <p className="search-result__description">{result.description}</p>
                ) : null}
                <p className="search-result__meta">
                  <span className="search-result__visibility">
                    {visibilityLabel(result.visibility)}
                  </span>
                  <span className="search-result__updated">
                    Updated <time dateTime={result.updatedAt}>{formatUpdatedAt(result.updatedAt)}</time>
                  </span>
                </p>
              </article>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

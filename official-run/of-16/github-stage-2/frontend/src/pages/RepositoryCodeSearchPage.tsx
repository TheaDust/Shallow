import { useEffect, useState } from "react";

import { ApiError } from "../lib/api";
import { makeHash } from "../lib/hash-route";
import { searchRepositoryCode } from "../repositories/api";
import { countLabel } from "../repositories/format";
import { REPOSITORY_SEARCH_SUFFIX, repositoryBlobSuffix, repositoryPath } from "../repositories/routes";
import type { RepositoryCodeSearch, RepositoryOwnerKind } from "../repositories/types";

export interface RepositoryCodeSearchPageProps {
  ownerKind: RepositoryOwnerKind;
  owner: string;
  name: string;
  query: string;
}

type LoadFailure = "notFound" | "denied" | "failed";

/**
 * Code search results of one repository. The query is part of the address, so
 * the results and the query in the Search box survive a reload, a repeated
 * search reads the same stored content, and the search stays read-only: it
 * never creates a commit and never changes a file.
 */
export function RepositoryCodeSearchPage({ ownerKind, owner, name, query }: RepositoryCodeSearchPageProps) {
  const [search, setSearch] = useState<RepositoryCodeSearch | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSearch(null);
    setFailure(null);
    searchRepositoryCode(ownerKind, owner, name, query)
      .then((next) => {
        if (!cancelled) setSearch(next);
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) setFailure("denied");
        else if (error instanceof ApiError && error.status === 404) setFailure("notFound");
        else setFailure("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [ownerKind, owner, name, query]);

  if (failure === "notFound") {
    return (
      <section className="page page--narrow">
        <h1>Repository not found</h1>
        <p className="page__lead">The address does not match a repository visible to you.</p>
      </section>
    );
  }

  if (failure === "denied") {
    return (
      <section className="page page--narrow">
        <h1>Access denied</h1>
        <p className="page__lead">Your account cannot read this private repository.</p>
      </section>
    );
  }

  if (failure === "failed") {
    return (
      <section className="page page--narrow">
        <p role="alert">We could not run this search. Try again.</p>
      </section>
    );
  }

  if (!search) {
    return (
      <section className="page">
        <p role="status">Searching code…</p>
      </section>
    );
  }

  const codeResults = makeHash(
    repositoryPath(ownerKind, owner, name, REPOSITORY_SEARCH_SUFFIX),
    new URLSearchParams({ q: search.query, type: "code" }),
  );

  return (
    <section className="page">
      <nav className="repository-breadcrumb" aria-label="Repository">
        <a className="repository-breadcrumb__repository" href={`#${repositoryPath(ownerKind, owner, name)}`}>
          {search.owner.name}/{search.repository}
        </a>
      </nav>
      <h1>Search results</h1>
      <nav className="search-scopes" aria-label="Search results">
        <a className="search-scopes__entry" href={codeResults} aria-current="page">Code</a>
      </nav>
      <p className="repository-overview__meta">
        <span className="repository-search__branch">Branch {search.branch}</span>
      </p>
      {search.total === 0 ? (
        <div className="search-empty" role="status">
          <h2>No results</h2>
          <p className="search-empty__lead">
            We couldn&apos;t find any matching files for “{search.query}” in this repository.
          </p>
        </div>
      ) : (
        <>
          <p className="search-summary" role="status">
            {countLabel(search.total, "result")} for “{search.query}”
          </p>
          <ul className="search-results">
            {search.results.map((result) => (
              <li className="search-result" key={result.path}>
                <a
                  className="search-result__link"
                  href={`#${repositoryPath(ownerKind, owner, name, repositoryBlobSuffix(search.branch, result.path))}`}
                >
                  {result.name}
                </a>
                {result.path === result.name ? null : (
                  <span className="search-result__directory" aria-hidden="true">
                    {result.path.slice(0, result.path.length - result.name.length)}
                  </span>
                )}
                <ul className="search-result__lines">
                  {result.lines.map((line) => (
                    <li className="search-result__line" key={line.number}>
                      <span className="search-result__number" aria-hidden="true">{line.number}</span>
                      <span className="search-result__text">{line.text}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

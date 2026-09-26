import { useEffect, useState } from 'react';
import { apiSearchRepositories } from '../api';
import type { SearchRepository } from '../types';

interface SearchResultsPageProps {
  query: string;
  type: string;
}

export type SearchType =
  | 'repositories'
  | 'code'
  | 'issues'
  | 'pullrequests'
  | 'users';

const SEARCH_TYPES: { value: SearchType; label: string }[] = [
  { value: 'repositories', label: 'Repositories' },
  { value: 'code', label: 'Code' },
  { value: 'issues', label: 'Issues' },
  { value: 'pullrequests', label: 'Pull requests' },
  { value: 'users', label: 'Users' },
];

function formatUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) {
    return 'Updated recently';
  }
  return `Updated ${date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })}`;
}

/**
 * REQ-3-1 search results page. Entering a query in the top global search box
 * and pressing Enter lands here with the "Repositories" type filter active and
 * repository results already displayed. Each result link's accessible name is
 * exactly the repository name; the result also displays its owner/name
 * metadata, description, visibility, and update time. Queries with no matching
 * repository (including the other, non-matching type filters and a cleared
 * query) display "No results", so stale results are never retained.
 */
export default function SearchResultsPage({ query, type }: SearchResultsPageProps) {
  const [repositories, setRepositories] = useState<SearchRepository[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const trimmedQuery = query.trim();
  const showRepositories = type === 'repositories' && trimmedQuery !== '';

  useEffect(() => {
    let cancelled = false;
    setRepositories(null);
    setLoadError(false);
    if (!showRepositories) {
      return () => {
        cancelled = true;
      };
    }
    apiSearchRepositories(trimmedQuery).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setRepositories(result.repositories);
      } else {
        setLoadError(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [trimmedQuery, showRepositories]);

  const noResults =
    !showRepositories || (repositories !== null && repositories.length === 0);

  return (
    <div className="search-results-page">
      <h1>Search results</h1>
      {trimmedQuery !== '' ? (
        <p className="search-results-query muted-text">Results for “{trimmedQuery}”</p>
      ) : null}
      <nav className="search-type-filter" aria-label="Search type">
        {SEARCH_TYPES.map((entry) => (
          <a
            key={entry.value}
            className={
              type === entry.value
                ? 'search-type-filter-link active'
                : 'search-type-filter-link'
            }
            href={`#/search?q=${encodeURIComponent(trimmedQuery)}&type=${entry.value}`}
            aria-current={type === entry.value ? 'page' : undefined}
          >
            {entry.label}
          </a>
        ))}
      </nav>
      {loadError ? (
        <p role="alert" className="form-error">
          The search could not be completed.
        </p>
      ) : showRepositories && repositories === null ? (
        <p className="loading">Loading…</p>
      ) : noResults ? (
        <p className="search-no-results">No results</p>
      ) : (
        <ul className="search-result-list">
          {repositories!.map((repo) => (
            <li key={`${repo.owner}/${repo.name}`} className="search-result-item">
              <div className="search-result-heading">
                <a
                  className="search-result-name-link"
                  href={`#/repositories/${encodeURIComponent(repo.owner)}/${encodeURIComponent(
                    repo.name
                  )}`}
                >
                  {repo.name}
                </a>
                <span className="search-result-owner">
                  {repo.owner}/{repo.name}
                </span>
              </div>
              {repo.description ? (
                <p className="search-result-description">{repo.description}</p>
              ) : null}
              <div className="search-result-meta">
                <span className="repository-visibility">
                  {repo.visibility === 'public' ? 'Public' : 'Private'}
                </span>
                <span className="search-result-updated">
                  {formatUpdatedAt(repo.updatedAt)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { apiRepositoryCodeSearch } from '../api';
import { navigate } from '../router';
import { useSession } from '../session';
import type { RepositoryCodeSearchHit } from '../types';

interface RepositoryCodeSearchPageProps {
  owner: string;
  name: string;
  query: string;
  path: string;
  language: string;
}

/**
 * REQ-4-2-3: repository code-search results page. The repository page and the
 * search results expose one searchbox named "Search" (the header control,
 * which mirrors the exact query). The page displays the repository identity
 * and branch context, a unique results-type link named "Code", optional path
 * ("Path") and language ("Language") filters, and the matching files: each
 * result shows the matching snippet, the file path, and the branch context,
 * and its link's accessible name is exactly the file name, opening the file
 * location. An absent query shows "No code results" and keeps the repository
 * scope and filters unchanged. Access is read-only and follows the same
 * repository-visibility rule as the Code page (private repositories without
 * permission return Access denied).
 */
export default function RepositoryCodeSearchPage({
  owner,
  name,
  query,
  path: pathFilter,
  language,
}: RepositoryCodeSearchPageProps) {
  const { auth } = useSession();
  const [hits, setHits] = useState<RepositoryCodeSearchHit[] | null>(null);
  const [languages, setLanguages] = useState<string[]>([]);
  const [branchName, setBranchName] = useState<string>('');
  const [denied, setDenied] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const trimmedQuery = query.trim();

  useEffect(() => {
    let cancelled = false;
    setHits(null);
    setLanguages([]);
    setBranchName('');
    setDenied(false);
    setNotFound(false);
    setLoadError(false);
    if (trimmedQuery === '') {
      return () => {
        cancelled = true;
      };
    }
    apiRepositoryCodeSearch(owner, name, {
      q: trimmedQuery,
      path: pathFilter,
      lang: language,
    }).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setHits(result.results);
        setLanguages(result.languages);
        setBranchName(result.branch ? result.branch.name : '');
      } else if (result.status === 403) {
        setDenied(true);
      } else if (result.status === 404) {
        setNotFound(true);
      } else {
        setLoadError(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [owner, name, trimmedQuery, pathFilter, language]);

  const repoBase = `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

  function buildSearchHref(nextQuery: string, nextPath: string, nextLang: string): string {
    const params = new URLSearchParams();
    if (nextQuery.trim() !== '') {
      params.set('q', nextQuery.trim());
    }
    if (nextPath.trim() !== '') {
      params.set('path', nextPath.trim());
    }
    if (nextLang.trim() !== '') {
      params.set('lang', nextLang.trim());
    }
    const queryString = params.toString();
    return `${repoBase}/search${queryString ? `?${queryString}` : ''}`;
  }

  const searchHref = buildSearchHref(trimmedQuery, pathFilter, language);

  function updatePath(nextPath: string) {
    navigate(buildSearchHref(trimmedQuery, nextPath, language));
  }

  function updateLanguage(nextLang: string) {
    navigate(buildSearchHref(trimmedQuery, pathFilter, nextLang));
  }

  function blobHref(hit: RepositoryCodeSearchHit): string {
    const pathPart = hit.path
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `${repoBase}/blob/${encodeURIComponent(hit.branch)}/${pathPart}`;
  }

  if (denied) {
    return (
      <div className="repository-page repository-denied">
        <h1>Access denied</h1>
        <p className="muted-text">
          You do not have permission to search code in this repository.
        </p>
        {auth.status === 'ready' && !auth.user ? (
          <a className="primary-link" href="#/signin">
            Sign in
          </a>
        ) : null}
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="repository-page">
        <h1>Repository not found</h1>
        <p className="muted-text">
          The repository “{owner}/{name}” does not exist or is not accessible.
        </p>
      </div>
    );
  }

  return (
    <div className="repository-page code-search-page">
      <h1 className="repository-title">
        {owner}/{name}
      </h1>
      <div className="code-search-heading-line">
        <h2 className="code-search-title">Code search</h2>
        {branchName !== '' ? (
          <span className="code-search-branch">Branch: {branchName}</span>
        ) : null}
      </div>
      <nav className="search-type-filter" aria-label="Search type">
        <a
          className="search-type-filter-link active"
          href={searchHref}
          aria-current="page"
        >
          Code
        </a>
      </nav>
      <div className="code-search-filters">
        <div className="code-search-filter">
          <label htmlFor="code-search-path-filter">Path</label>
          <input
            id="code-search-path-filter"
            type="text"
            className="code-search-filter-input"
            value={pathFilter}
            onChange={(e) => updatePath(e.target.value)}
          />
        </div>
        <div className="code-search-filter">
          <label htmlFor="code-search-language-filter">Language</label>
          <select
            id="code-search-language-filter"
            className="code-search-filter-input"
            value={language}
            onChange={(e) => updateLanguage(e.target.value)}
          >
            <option value="">All languages</option>
            {languages.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        </div>
      </div>
      {loadError ? (
        <p role="alert" className="form-error">
          The search could not be completed.
        </p>
      ) : trimmedQuery === '' ? null : hits === null ? (
        <p className="loading">Loading…</p>
      ) : hits.length === 0 ? (
        <p className="search-no-results">No code results</p>
      ) : (
        <ul className="code-search-result-list">
          {hits.map((hit) => (
            <li key={hit.path} className="code-search-result-item">
              <div className="code-search-result-heading">
                <a className="code-search-result-link" href={blobHref(hit)}>
                  {hit.name}
                </a>
                <span className="code-search-result-path">{hit.path}</span>
              </div>
              <div className="code-search-result-meta">
                <span className="code-search-result-branch">{hit.branch}</span>
                <span className="code-search-result-line">Line {hit.line}</span>
              </div>
              <pre className="code-search-snippet">{hit.snippet}</pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

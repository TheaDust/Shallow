import { useEffect, useState } from 'react';
import { apiRepositoryIssues } from '../api';
import { navigate } from '../router';
import { useSession } from '../session';
import { formatRelativeTime } from '../format';
import type { IssueSummary } from '../types';

interface IssuesPageProps {
  owner: string;
  name: string;
  /** '' shows both states; 'open'/'closed' filter by status. */
  state: string;
  /** The issue search-box value (title or body keyword). */
  query: string;
  /** '' shows every label; a label name restricts rows to that label. */
  label: string;
}

/**
 * REQ-5-1-1: the Issues list page of a repository (the list page in the
 * repository navigation). It reads every issue row of the current repository
 * under the same repository-view rule as the overview and displays each
 * row's persisted number, title, status, author, labels, and update time.
 * “Open” and “Closed” are links (not buttons/tabs), the unique searchbox
 * named “Search issues” filters as the user types (no Enter / search
 * button), and the label filter restricts rows to one label. Filtering only
 * changes the rows currently displayed in the browser (it never writes or
 * deletes issues) and the chosen filter context travels in the hash query
 * string, so refreshing retains it and the matching results. Each result
 * title is a link whose exact accessible name is the title and opens that
 * issue's detail page.
 */
export default function IssuesPage({ owner, name, state, query, label }: IssuesPageProps) {
  const { auth } = useSession();
  const [issues, setIssues] = useState<IssueSummary[] | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIssues(null);
    setDenied(false);
    setNotFound(false);
    setLoadError(false);
    apiRepositoryIssues(owner, name).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setIssues(result.issues);
        setLabels(result.labels);
        setRole(result.role);
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
  }, [owner, name]);

  const repoBase = `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

  // REQ-5-2-1: “New issue” is a link on the Issues page, rendered only for
  // Write, Maintain, Admin, or organization Owner accounts (Read/Triage/
  // visitors only view; the server re-checks the role on every submission).
  const canCreateIssue =
    role === 'write' || role === 'maintain' || role === 'admin';

  /**
   * The filter context (state, keyword, label) lives in the hash query
   * string so reloads and re-entering the page keep the chosen filters and
   * the matching rows. The raw query is preserved (trimming happens only
   * when matching) so the searchbox mirrors exactly what the user typed.
   */
  function buildHref(nextState: string, nextQuery: string, nextLabel: string): string {
    const params = new URLSearchParams();
    if (nextState !== '') {
      params.set('state', nextState);
    }
    if (nextQuery !== '') {
      params.set('q', nextQuery);
    }
    if (nextLabel !== '') {
      params.set('label', nextLabel);
    }
    const queryString = params.toString();
    return `${repoBase}/issues${queryString ? `?${queryString}` : ''}`;
  }

  const keyword = query.trim().toLowerCase();

  const visibleIssues = (issues ?? []).filter((issue) => {
    if (state === 'open' && issue.state !== 'open') {
      return false;
    }
    if (state === 'closed' && issue.state !== 'closed') {
      return false;
    }
    if (label !== '' && !issue.labels.includes(label)) {
      return false;
    }
    if (keyword !== '') {
      const haystack = `${issue.title}\n${issue.body ?? ''}`.toLowerCase();
      if (!haystack.includes(keyword)) {
        return false;
      }
    }
    return true;
  });

  function updateQuery(nextQuery: string) {
    navigate(buildHref(state, nextQuery, label));
  }

  function updateLabel(nextLabel: string) {
    navigate(buildHref(state, query, nextLabel));
  }

  // Clicking the already-active state link again returns to the combined
  // (both states) list, so every filter can be cleared without extra steps.
  function stateHref(nextState: string): string {
    return buildHref(state === nextState ? '' : nextState, query, label);
  }

  if (denied) {
    return (
      <div className="repository-page repository-denied">
        <h1>Access denied</h1>
        <p className="muted-text">
          You do not have permission to view issues in this repository.
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
        <h1>Issues</h1>
        <p className="muted-text">
          The repository “{owner}/{name}” does not exist or is not accessible.
        </p>
      </div>
    );
  }

  return (
    <div className="repository-page issues-page">
      <h1>Issues</h1>
      <div className="issues-page-header">
        <p className="muted-text">
          <a className="repository-back-link" href={repoBase}>
            {owner}/{name}
          </a>
        </p>
        {canCreateIssue ? (
          <a className="new-issue-link" href={`${repoBase}/issues/new`}>
            New issue
          </a>
        ) : null}
      </div>
      <div className="issues-filter-bar">
        {/* REQ-5-1-1: “Open” and “Closed” are links, not buttons or tabs. */}
        <div className="issues-state-filter">
          <a
            className={`issues-state-link${state === 'open' ? ' active' : ''}`}
            href={stateHref('open')}
            aria-current={state === 'open' ? 'page' : undefined}
          >
            Open
          </a>
          <a
            className={`issues-state-link${state === 'closed' ? ' active' : ''}`}
            href={stateHref('closed')}
            aria-current={state === 'closed' ? 'page' : undefined}
          >
            Closed
          </a>
        </div>
        {/* REQ-5-1-1: the unique searchbox named “Search issues” filters as
            the user types; no Enter or separate search button is needed. */}
        <div className="issues-search-field">
          <label htmlFor="issues-search-input">Search issues</label>
          <input
            id="issues-search-input"
            type="search"
            className="issues-search-input"
            value={query}
            onChange={(e) => updateQuery(e.target.value)}
            placeholder="Search issues"
          />
        </div>
        {/* The label filter is a native select whose options are the
            repository's pre-existing labels (e.g. “bug”). */}
        <div className="issues-label-filter">
          <label htmlFor="issues-label-select">Label</label>
          <select
            id="issues-label-select"
            className="issues-label-select"
            value={label}
            onChange={(e) => updateLabel(e.target.value)}
          >
            <option value="">All labels</option>
            {labels.map((labelName) => (
              <option key={labelName} value={labelName}>
                {labelName}
              </option>
            ))}
          </select>
        </div>
      </div>
      {loadError ? (
        <p role="alert" className="form-error">
          The issues could not be loaded.
        </p>
      ) : issues === null ? (
        <p className="loading">Loading…</p>
      ) : visibleIssues.length === 0 ? (
        <p className="issues-empty">No issues match your filters.</p>
      ) : (
        <ul className="issues-list">
          {visibleIssues.map((issue) => (
            <li key={issue.number} className="issue-row">
              <div className="issue-row-heading">
                <a className="issue-title-link" href={`${repoBase}/issues/${issue.number}`}>
                  {issue.title}
                </a>
                <span className="issue-number">#{issue.number}</span>
              </div>
              <div className="issue-row-meta">
                <span className={`issue-state issue-state-${issue.state}`}>
                  {issue.state === 'open' ? 'Open' : 'Closed'}
                </span>
                <span className="issue-author">{issue.author ?? 'Unknown'}</span>
                {issue.labels.map((labelName) => (
                  <span key={labelName} className="issue-label">
                    {labelName}
                  </span>
                ))}
                <span className="issue-updated">
                  {formatRelativeTime(issue.updatedAt) !== ''
                    ? `Updated ${formatRelativeTime(issue.updatedAt)}`
                    : ''}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

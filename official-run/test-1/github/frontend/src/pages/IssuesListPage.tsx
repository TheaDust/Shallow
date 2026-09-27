import { useEffect, useState } from 'react';
import RepositoryLayout from '../components/RepositoryLayout';
import { formatUpdatedAt } from '../repository';
import { filtersFromHash, issueUrl, issuesUrl, parseLabelsParam, useRepositoryIssues } from '../issues';
import type { IssueSummary } from '../api';

function filterIssues(
  issues: IssueSummary[],
  state: string,
  q: string,
  labels: string[]
): IssueSummary[] {
  const keyword = q.trim().toLowerCase();
  return issues.filter((issue) => {
    if (state === 'open' && issue.status !== 'open') return false;
    if (state === 'closed' && issue.status !== 'closed') return false;
    if (keyword) {
      const haystack = `${issue.title} ${issue.description || ''}`.toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    if (labels.length > 0 && !labels.every((label) => issue.labels.includes(label))) return false;
    return true;
  });
}

function toggleLabel(current: string[], name: string): string[] {
  return current.includes(name) ? current.filter((l) => l !== name) : [...current, name];
}

export default function IssuesListPage({
  owner,
  name,
  query,
}: {
  owner: string;
  name: string;
  query: URLSearchParams;
}) {
  const { state, reload } = useRepositoryIssues(owner, name);
  const [labelFilterOpen, setLabelFilterOpen] = useState(false);
  // The search box is controlled locally so every keystroke updates the visible
  // rows immediately; the URL query stays the source of truth for refresh/back.
  const [qInput, setQInput] = useState(() => query.get('q') || '');
  useEffect(() => {
    setQInput(query.get('q') || '');
  }, [query]);

  if (state.status === 'loading') {
    return (
      <main className="repo-page">
        <p>Loading…</p>
      </main>
    );
  }

  if (state.status === 'notFound') {
    return (
      <main className="repo-page">
        <h1>Repository not found</h1>
        <p className="muted">The repository does not exist or you do not have access to it.</p>
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="repo-page">
        <div role="alert">
          <p className="form-error">Issues could not be loaded. Please try again.</p>
          <button type="button" className="secondary-button" onClick={reload}>
            Retry
          </button>
        </div>
      </main>
    );
  }

  const repository = state.repository;
  const stateFilter = query.get('state') || '';
  const q = query.get('q') || '';
  const labelFilter = parseLabelsParam(query.get('labels'));
  const visible = filterIssues(state.issues, stateFilter, q, labelFilter);

  function updateFilters(next: { state?: string; q?: string; labels?: string[] }) {
    // Merge over the filters currently in the URL, never over a stale render.
    const current = filtersFromHash(window.location.hash);
    const target = issuesUrl(owner, name, {
      state: next.state !== undefined ? next.state : current.state,
      q: next.q !== undefined ? next.q : current.q,
      labels: next.labels !== undefined ? next.labels : current.labels,
    });
    if (target !== window.location.hash) {
      window.location.hash = target;
    }
  }

  return (
    <RepositoryLayout repository={repository} activeTab="issues">
      <div className="issues-toolbar">
        <div className="issues-state-filter">
          <a
            href={
              stateFilter === 'open'
                ? issuesUrl(owner, name, { q, labels: labelFilter })
                : issuesUrl(owner, name, { state: 'open', q, labels: labelFilter })
            }
            aria-current={stateFilter === 'open' ? 'page' : undefined}
          >
            Open
          </a>
          <a
            href={
              stateFilter === 'closed'
                ? issuesUrl(owner, name, { q, labels: labelFilter })
                : issuesUrl(owner, name, { state: 'closed', q, labels: labelFilter })
            }
            aria-current={stateFilter === 'closed' ? 'page' : undefined}
          >
            Closed
          </a>
        </div>
        <input
          type="search"
          className="issues-search"
          aria-label="Search issues"
          placeholder="Search issues"
          value={qInput}
          onChange={(event) => {
            setQInput(event.target.value);
            updateFilters({ q: event.target.value });
          }}
        />
        <div className="issues-label-filter">
          <button
            type="button"
            className="secondary-button"
            aria-expanded={labelFilterOpen}
            onClick={() => setLabelFilterOpen((open) => !open)}
          >
            Labels
          </button>
          {labelFilterOpen && (
            <div role="listbox" aria-label="Labels" className="filter-popover">
              {state.labels.map((label) => (
                <div
                  key={label.name}
                  role="option"
                  aria-selected={labelFilter.includes(label.name)}
                  onClick={() =>
                    updateFilters({
                      labels: toggleLabel(filtersFromHash(window.location.hash).labels || [], label.name),
                    })
                  }
                >
                  {label.name}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="muted">No issues</p>
      ) : (
        <ul className="issue-list">
          {visible.map((issue) => (
            <li key={issue.number} className="issue-row">
              <div className="issue-row-main">
                <a className="issue-number" href={issueUrl(owner, name, issue.number)}>
                  #{issue.number}
                </a>
                <a className="issue-title" href={issueUrl(owner, name, issue.number)}>
                  {issue.title}
                </a>
                {issue.labels.map((label) => (
                  <span key={label} className="label-badge">
                    {label}
                  </span>
                ))}
              </div>
              <div className="issue-row-meta">
                <span className="issue-row-status">{issue.status === 'open' ? 'Open' : 'Closed'}</span>
                <span>by {issue.author}</span>
                <span>updated {formatUpdatedAt(issue.updatedAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </RepositoryLayout>
  );
}

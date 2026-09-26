import { useEffect, useState } from 'react';
import { apiRepositoryPulls } from '../api';
import { navigate } from '../router';
import { useSession } from '../session';
import { formatRelativeTime } from '../format';
import type { PullRequestSummary } from '../types';

interface PullRequestsPageProps {
  owner: string;
  name: string;
  /** '' shows every status; 'draft'|'open'|'closed'|'merged' filter by status. */
  state: string;
  /** The author filter keyword (matches the author username as the user types). */
  author: string;
  /** '' shows every review status; otherwise one of the review-status values. */
  review: string;
}

/**
 * REQ-6-1/REQ-6-2-1: the Pull requests list page of a repository. It reads
 * every pull request row of the current repository under the same
 * repository-view rule as the overview and displays each row's persisted
 * number, title (a link whose exact accessible name is the title and opens
 * that PR's detail page), author, source/target branches, and status. The
 * list is read-only: a PR is a persistent proposal and reading it never
 * changes the PR or the branches.
 *
 * REQ-6-2-1: any user with repository-view permission may filter the current
 * list display by status (Draft/Open/Closed/Merged), author, or review
 * status. “Open”, “Closed”, “Draft”, and “Merged” are links (not buttons);
 * the unique author filter is a textbox named “Author” that filters as the
 * user types, and the review-status filter is a select named “Review
 * status”. Filtering only changes the rows currently displayed in the
 * browser — it never modifies PRs, branches, or reviews — and the chosen
 * filter context travels in the hash query string, so refreshing retains it
 * and the matching rows.
 */
export default function PullRequestsPage({
  owner,
  name,
  state,
  author,
  review,
}: PullRequestsPageProps) {
  const { auth } = useSession();
  const [pulls, setPulls] = useState<PullRequestSummary[] | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPulls(null);
    setRole(null);
    setDenied(false);
    setNotFound(false);
    setLoadError(false);
    apiRepositoryPulls(owner, name).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setPulls(result.pulls);
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

  /**
   * REQ-6-2-2: only a signed-in user with Write, Maintain, Admin, or
   * organization Owner status may enter the creation-comparison flow, so the
   * “New pull request” link is only rendered for those roles (the server
   * still rejects unauthorized comparison requests).
   */
  const canCreatePullRequest =
    role === 'write' || role === 'maintain' || role === 'admin';

  const statusText = (status: PullRequestSummary['status']) => {
    switch (status) {
      case 'draft':
        return 'Draft';
      case 'open':
        return 'Open';
      case 'closed':
        return 'Closed';
      case 'merged':
        return 'Merged';
      default:
        return status;
    }
  };

  /**
   * The filter context (state, author keyword, review status) lives in the
   * hash query string so reloads and re-entering the page keep the chosen
   * filters and the matching rows. The raw author keyword is preserved
   * (trimming happens only when matching) so the textbox mirrors exactly
   * what the user typed.
   */
  function buildHref(nextState: string, nextAuthor: string, nextReview: string): string {
    const params = new URLSearchParams();
    if (nextState !== '') {
      params.set('state', nextState);
    }
    if (nextAuthor !== '') {
      params.set('author', nextAuthor);
    }
    if (nextReview !== '') {
      params.set('review', nextReview);
    }
    const queryString = params.toString();
    return `${repoBase}/pulls${queryString ? `?${queryString}` : ''}`;
  }

  function updateAuthor(nextAuthor: string) {
    navigate(buildHref(state, nextAuthor, review));
  }

  function updateReview(nextReview: string) {
    navigate(buildHref(state, author, nextReview));
  }

  // Clicking the already-active status link again returns to the combined
  // (every status) list, so every filter can be cleared without extra steps.
  function stateHref(nextState: string): string {
    return buildHref(state === nextState ? '' : nextState, author, review);
  }

  const authorKeyword = author.trim().toLowerCase();

  const visiblePulls = (pulls ?? []).filter((pull) => {
    if (state === 'draft' && pull.status !== 'draft') {
      return false;
    }
    if (state === 'open' && pull.status !== 'open') {
      return false;
    }
    if (state === 'closed' && pull.status !== 'closed') {
      return false;
    }
    if (state === 'merged' && pull.status !== 'merged') {
      return false;
    }
    if (authorKeyword !== '') {
      const authorName = (pull.author ?? '').toLowerCase();
      if (!authorName.includes(authorKeyword)) {
        return false;
      }
    }
    if (review !== '' && pull.reviewStatus !== review) {
      return false;
    }
    return true;
  });

  if (denied) {
    return (
      <div className="repository-page repository-denied">
        <h1>Access denied</h1>
        <p className="muted-text">
          You do not have permission to view pull requests in this repository.
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
        <h1>Pull requests</h1>
        <p className="muted-text">
          The repository “{owner}/{name}” does not exist or is not accessible.
        </p>
      </div>
    );
  }

  return (
    <div className="repository-page pulls-page">
      <h1>Pull requests</h1>
      <div className="pulls-page-header">
        <p className="muted-text">
          <a className="repository-back-link" href={repoBase}>
            {owner}/{name}
          </a>
        </p>
        {canCreatePullRequest ? (
          <a className="primary-link new-pull-request-link" href={`${repoBase}/pulls/new`}>
            New pull request
          </a>
        ) : null}
      </div>
      <div className="pulls-filter-bar">
        {/* REQ-6-2-1: “Open” (and the other statuses) are links, not buttons
            or tabs. Selecting one filters the list by that status. */}
        <div className="pulls-state-filter">
          {(
            [
              ['draft', 'Draft'],
              ['open', 'Open'],
              ['closed', 'Closed'],
              ['merged', 'Merged'],
            ] as const
          ).map(([value, label]) => (
            <a
              key={value}
              className={`pulls-state-link${state === value ? ' active' : ''}`}
              href={stateHref(value)}
              aria-current={state === value ? 'page' : undefined}
            >
              {label}
            </a>
          ))}
        </div>
        {/* REQ-6-2-1: the unique author filter textbox named “Author” filters
            as the user types; no Enter or separate search button is needed. */}
        <div className="pulls-author-field">
          <label htmlFor="pulls-author-input">Author</label>
          <input
            id="pulls-author-input"
            type="search"
            className="pulls-author-input"
            value={author}
            onChange={(e) => updateAuthor(e.target.value)}
            placeholder="Author"
          />
        </div>
        {/* The review-status filter is a native select; choosing a value
            restricts the rows to that review status of the current compare
            commit (it only changes the displayed rows). */}
        <div className="pulls-review-filter">
          <label htmlFor="pulls-review-select">Review status</label>
          <select
            id="pulls-review-select"
            className="pulls-review-select"
            value={review}
            onChange={(e) => updateReview(e.target.value)}
          >
            <option value="">All review statuses</option>
            <option value="review_required">Review required</option>
            <option value="approved">Approved</option>
            <option value="changes_requested">Changes requested</option>
          </select>
        </div>
      </div>
      {loadError ? (
        <p role="alert" className="form-error">
          The pull requests could not be loaded.
        </p>
      ) : pulls === null ? (
        <p className="loading">Loading…</p>
      ) : visiblePulls.length === 0 ? (
        <p className="pulls-empty">No pull requests match your filters.</p>
      ) : (
        <ul className="pulls-list">
          {visiblePulls.map((pull) => (
            <li key={pull.number} className="pull-row">
              <div className="pull-row-heading">
                <a
                  className="pull-title-link"
                  href={`${repoBase}/pulls/${pull.number}`}
                >
                  {pull.title}
                </a>
                <span className="pull-number">#{pull.number}</span>
              </div>
              <div className="pull-row-meta">
                <span className={`pull-status pull-status-${pull.status}`}>
                  {statusText(pull.status)}
                </span>
                <span className="pull-author">{pull.author ?? 'Unknown'}</span>
                <span className="pull-branches">
                  {pull.compareBranch} → {pull.baseBranch}
                </span>
                <span className="pull-updated">
                  {formatRelativeTime(pull.updatedAt) !== ''
                    ? `Updated ${formatRelativeTime(pull.updatedAt)}`
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

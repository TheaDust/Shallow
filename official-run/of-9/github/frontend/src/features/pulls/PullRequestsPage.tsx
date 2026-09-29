import { useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import { formatUpdatedTime } from "../../lib/format";
import { makeHash, useHashLocation } from "../../lib/hash-route";
import { RepoNav } from "../issues/RepoNav";
import { AccessDenied } from "../organizations/AccessDenied";
import type { RepoRole } from "../organizations/api";
import { listPullRequests, type PullRequestsListData, type PullRequestSummary } from "./api";

const WRITABLE_ROLES: RepoRole[] = ["write", "maintain", "admin"];

// Status filters are links so the exact accessible names Draft / Open / Closed
// / Merged are available to every viewer, including visitors; the active
// selection and the author/review filters live in the hash query and only
// affect the current list display (filtering never writes PR data).
const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "merged", label: "Merged" },
];

const REVIEW_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "Any review status" },
  { value: "reviewed", label: "Reviewed" },
  { value: "unreviewed", label: "Unreviewed" },
  { value: "approved", label: "Approved" },
  { value: "changes_requested", label: "Changes requested" },
  { value: "review_requested", label: "Review requested" },
];

function matchesFilters(pull: PullRequestSummary, status: string, author: string, review: string): boolean {
  if (status && pull.status !== status) return false;
  if (author && !pull.author.toLowerCase().includes(author.toLowerCase())) return false;
  if (review === "reviewed" && pull.reviews.length === 0) return false;
  if (review === "unreviewed" && pull.reviews.length > 0) return false;
  if (review === "approved" && !pull.reviews.some((entry) => entry.decision === "approve")) return false;
  if (review === "changes_requested" && !pull.reviews.some((entry) => entry.decision === "request_changes")) {
    return false;
  }
  if (review === "review_requested" && !pull.reviewRequested) return false;
  return true;
}

export function PullRequestsPage({ owner, name }: { owner: string; name: string }) {
  const location = useHashLocation();
  const statusFilter = location.search.get("status") ?? "";
  const authorFilter = location.search.get("author") ?? "";
  const reviewFilter = location.search.get("review") ?? "";
  const [data, setData] = useState<PullRequestsListData | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "denied" | "missing">("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    listPullRequests(owner, name)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setStatus("ok");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) setStatus("denied");
        else setStatus("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [owner, name]);

  const withFilters = (changes: Record<string, string>) => {
    const search = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(changes)) {
      if (value) search.set(key, value);
      else search.delete(key);
    }
    window.location.hash = makeHash(`/repos/${owner}/${name}/pulls`, search);
  };

  if (status === "denied") return <AccessDenied />;
  if (status === "missing") {
    return (
      <section className="pulls-list">
        <RepoNav owner={owner} name={name} active="pulls" />
        <h1>Pull requests</h1>
        <p className="pulls-list__empty">Not found</p>
      </section>
    );
  }
  if (status === "loading" || !data) {
    return (
      <p role="status" className="page-status">
        Loading…
      </p>
    );
  }

  const canCreate = data.myRole !== null && WRITABLE_ROLES.includes(data.myRole);
  const filtered = data.pulls.filter((pull) =>
    matchesFilters(pull, statusFilter, authorFilter, reviewFilter),
  );
  const hasFilters = Boolean(statusFilter || authorFilter || reviewFilter);

  return (
    <section className="pulls-list">
      <RepoNav owner={owner} name={name} active="pulls" />
      <header className="pulls-list__header">
        <h1>Pull requests</h1>
        {canCreate ? (
          <a className="ui-button ui-button--primary" href={`#/repos/${owner}/${name}/pulls/new`}>
            New pull request
          </a>
        ) : null}
      </header>

      <div className="pulls-list__filters" aria-label="Filter pull requests">
        <nav className="pulls-list__status-filters" aria-label="Filter by status">
          {STATUS_FILTERS.map((filter) => (
            <a
              key={filter.value}
              className={statusFilter === filter.value ? "pulls-list__filter pulls-list__filter--active" : "pulls-list__filter"}
              href={makeHash(`/repos/${owner}/${name}/pulls`, new URLSearchParams({ ...Object.fromEntries(location.search), status: filter.value }))}
              aria-current={statusFilter === filter.value ? "true" : undefined}
            >
              {filter.label}
            </a>
          ))}
        </nav>
        <div className="ui-field pulls-list__author-filter">
          <label htmlFor="pulls-author">Author</label>
          <input
            id="pulls-author"
            value={authorFilter}
            onChange={(event) => withFilters({ author: event.target.value })}
          />
        </div>
        <div className="ui-field pulls-list__review-filter">
          <label htmlFor="pulls-review">Review status</label>
          <select
            id="pulls-review"
            value={reviewFilter}
            onChange={(event) => withFilters({ review: event.target.value })}
          >
            {REVIEW_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="pulls-list__empty">
          {hasFilters ? "No pull requests match your filters." : "No pull requests yet."}
        </p>
      ) : (
        <ul className="pulls-list__items">
          {filtered.map((pull) => (
            <li key={pull.number} className="pulls-list__item">
              <div className="pulls-list__item-main">
                <span className="pulls-list__number">#{pull.number}</span>
                <a
                  className="pulls-list__title"
                  href={`#/repos/${owner}/${name}/pulls/${pull.number}`}
                >
                  {pull.title}
                </a>
                <span className={`pulls-list__status pulls-list__status--${pull.status}`}>
                  {pull.status === "draft"
                    ? "Draft"
                    : pull.status === "open"
                      ? "Open"
                      : pull.status === "closed"
                        ? "Closed"
                        : "Merged"}
                </span>
              </div>
              <div className="pulls-list__item-meta">
                <span className="pulls-list__branches">
                  {pull.compareBranch} into {pull.baseBranch}
                </span>
                <span className="pulls-list__author">{pull.author}</span>
                <span className="pulls-list__updated">
                  Updated {formatUpdatedTime(pull.updatedAt)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

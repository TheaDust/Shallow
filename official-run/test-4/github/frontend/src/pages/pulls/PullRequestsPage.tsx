import { useEffect, useState } from "react";

import { navigate, useHashLocation } from "../../lib/hash-route";
import { fetchPullRequests, PullSummary, pullStatusText } from "../../lib/pull-api";
import { repoOwnerBase, RepoOwnerType } from "../../lib/repo-api";
import { useSession } from "../../session";
import { RepoPageChrome } from "../repos/RepoPageChrome";
import { useRepoDetail } from "../repos/useRepoDetail";

interface PullRequestsPageProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
}

const STATUS_FILTERS = ["open", "closed", "draft", "merged"] as const;

/**
 * The Pull requests list page of the current repository (REQ-6-2-1): rows show
 * the PR number, the exact title as a link, the author, the source/target
 * branches, and the visible status. Any user with repository-view permission
 * can filter by Draft/Open/Closed/Merged status, author, or review status;
 * filtering is client-side and only affects the displayed rows, and the
 * chosen filters live in the hash query so a reload keeps the same list.
 * “New pull request” is a link that opens the creation-comparison page for
 * users with Write, Maintain, Admin, or organization Owner status.
 */
export function PullRequestsPage({ ownerType, ownerName, repoName }: PullRequestsPageProps) {
  const { status: sessionStatus } = useSession();
  const { status: detailStatus, repository } = useRepoDetail(ownerType, ownerName, repoName);
  const location = useHashLocation();
  const base = `${repoOwnerBase(ownerType, ownerName)}/repos/${encodeURIComponent(repoName)}`;

  const [pulls, setPulls] = useState<PullSummary[]>([]);
  const [listStatus, setListStatus] = useState<"loading" | "ready">("loading");
  const [stateFilter, setStateFilter] = useState(location.search.get("state") ?? "");
  const [authorFilter, setAuthorFilter] = useState(location.search.get("author") ?? "");
  const [reviewFilter, setReviewFilter] = useState(location.search.get("review") ?? "");

  useEffect(() => {
    setStateFilter(location.search.get("state") ?? "");
    setAuthorFilter(location.search.get("author") ?? "");
    setReviewFilter(location.search.get("review") ?? "");
  }, [location.search]);

  useEffect(() => {
    if (detailStatus !== "ready") return;
    let cancelled = false;
    setListStatus("loading");
    fetchPullRequests(ownerType, ownerName, repoName)
      .then((result) => {
        if (cancelled) return;
        setPulls(result.pulls);
        setListStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setListStatus("ready");
      });
    return () => {
      cancelled = true;
    };
  }, [detailStatus, ownerType, ownerName, repoName]);

  function filterParams(state: string, author: string, review: string): URLSearchParams {
    const params = new URLSearchParams();
    if (state) params.set("state", state);
    if (author) params.set("author", author);
    if (review) params.set("review", review);
    return params;
  }

  /** Reads the currently displayed filters from the URL at action time. */
  function readUrlFilters(): { state: string; author: string; review: string } {
    const raw = window.location.hash.replace(/^#/, "") || "/";
    const url = new URL(raw.startsWith("/") ? raw : `/${raw}`, "http://local");
    return {
      state: url.searchParams.get("state") ?? "",
      author: url.searchParams.get("author") ?? "",
      review: url.searchParams.get("review") ?? "",
    };
  }

  function updateFilters(next: { state?: string; author?: string; review?: string }) {
    const current = readUrlFilters();
    const state = next.state ?? current.state;
    const author = next.author ?? current.author;
    const review = next.review ?? current.review;
    setStateFilter(state);
    setAuthorFilter(author);
    setReviewFilter(review);
    const search = filterParams(state, author, review).toString();
    window.history.replaceState(null, "", `#${base}/pulls${search ? `?${search}` : ""}`);
  }

  function selectState(next: string) {
    const current = readUrlFilters();
    const value = current.state === next ? "" : next;
    navigate(`${base}/pulls`, filterParams(value, current.author, current.review));
  }

  const canCreate =
    sessionStatus === "authenticated" &&
    ["write", "maintain", "admin"].includes(repository?.currentRole ?? "");

  const authors = [...new Set(pulls.map((pull) => pull.author.username))].sort();

  const filtered = pulls.filter((pull) => {
    if (stateFilter && pull.status !== stateFilter) return false;
    if (authorFilter && pull.author.username !== authorFilter) return false;
    if (reviewFilter === "reviewed" && !pull.reviewed) return false;
    if (reviewFilter === "not-reviewed" && pull.reviewed) return false;
    return true;
  });

  return (
    <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName} section="pulls">
      {detailStatus === "notfound" ? (
        <p>Repository not found.</p>
      ) : detailStatus === "denied" ? (
        <p>Access denied</p>
      ) : detailStatus !== "ready" || listStatus !== "ready" ? (
        <p>Loading…</p>
      ) : (
        <>
          <div className="issues-toolbar">
            <h2>Pull requests</h2>
            {canCreate && (
              <a className="button" href={`#${base}/pulls/new`}>
                New pull request
              </a>
            )}
          </div>
          <div className="issues-filters">
            <span className="issues-filters__states">
              {STATUS_FILTERS.map((status) => (
                <a
                  key={status}
                  href={`#${base}/pulls?${filterParams(status, authorFilter, reviewFilter).toString()}`}
                  aria-current={stateFilter === status ? "true" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    selectState(status);
                  }}
                >
                  {pullStatusText(status)}
                </a>
              ))}
            </span>
            <div className="issues-filters__field">
              <label htmlFor="pull-author-filter">Author</label>
              <select
                id="pull-author-filter"
                value={authorFilter}
                onChange={(event) => updateFilters({ author: event.target.value })}
              >
                <option value="">All authors</option>
                {authors.map((username) => (
                  <option key={username} value={username}>
                    {username}
                  </option>
                ))}
              </select>
            </div>
            <div className="issues-filters__field">
              <label htmlFor="pull-review-filter">Review status</label>
              <select
                id="pull-review-filter"
                value={reviewFilter}
                onChange={(event) => updateFilters({ review: event.target.value })}
              >
                <option value="">Any review status</option>
                <option value="reviewed">Reviewed</option>
                <option value="not-reviewed">Not reviewed</option>
              </select>
            </div>
          </div>
          <ul className="issues-list">
            {filtered.map((pull) => (
              <li key={pull.number} className="issues-list__item">
                <span className={`issues-list__state issues-list__state--${pull.status}`}>
                  {pullStatusText(pull.status)}
                </span>
                <a className="issues-list__number" href={`#${base}/pulls/${pull.number}`}>
                  #{pull.number}
                </a>
                <a className="issues-list__title" href={`#${base}/pulls/${pull.number}`}>
                  {pull.title}
                </a>
                <span className="issues-list__meta">
                  <span>
                    #{pull.number} opened by {pull.author.username}
                  </span>
                  <span>
                    {pull.compareBranch} into {pull.baseBranch}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {filtered.length === 0 && <p>No pull requests found.</p>}
        </>
      )}
    </RepoPageChrome>
  );
}

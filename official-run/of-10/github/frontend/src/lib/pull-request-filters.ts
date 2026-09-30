import { makeHash } from "./hash-route";
import {
  pullRequestStatusLabel,
  type PullRequestStatus,
  type PullRequestSummary,
  type ReviewStatus,
} from "./pull-requests-api";
import { repositoryPullRequestsSearch, type PullRequestFilterQuery } from "./repository-routes";

/**
 * The Pull requests list filter (REQ-6-2-1): the status, the author and the
 * review status. Filtering only selects which rows the browser displays — it
 * never writes or deletes a pull request, a branch or a review. The chosen
 * filter travels in the page address, so refreshing the page keeps the rows.
 */
export interface PullRequestFilterValues {
  /** `null` means every status is displayed. */
  status: PullRequestStatus | null;
  author: string;
  /** `""` means every review status is displayed. */
  review: ReviewStatus | "";
}

export const EMPTY_PULL_REQUEST_FILTERS: PullRequestFilterValues = {
  status: null,
  author: "",
  review: "",
};

export type PullRequestFilterPatch = Partial<PullRequestFilterValues>;

/** Reads the status of a page address; an unknown value shows every status. */
export function readPullRequestStatus(value: string | null | undefined): PullRequestStatus | null {
  return value === "draft" || value === "open" || value === "closed" || value === "merged"
    ? value
    : null;
}

export function readReviewStatus(value: string | null | undefined): ReviewStatus | "" {
  return value === "approved" || value === "changes_requested" || value === "review_required"
    ? value
    : "";
}

export function readPullRequestFilters(search: URLSearchParams): PullRequestFilterValues {
  return {
    status: readPullRequestStatus(search.get("state")),
    author: search.get("author") ?? "",
    review: readReviewStatus(search.get("review")),
  };
}

/** The address fragment of one filter combination. */
export function toPullRequestFilterQuery(
  filters: PullRequestFilterValues,
): PullRequestFilterQuery {
  return {
    ...(filters.status ? { state: filters.status } : {}),
    ...(filters.author.trim() ? { author: filters.author.trim() } : {}),
    ...(filters.review ? { review: filters.review } : {}),
  };
}

/**
 * Matches one row against the filter: the persisted status, the author name and
 * the review status of the pull request's current compare commit.
 */
export function matchesPullRequestFilters(
  pullRequest: PullRequestSummary,
  filters: PullRequestFilterValues,
): boolean {
  if (filters.status && pullRequest.status !== filters.status) return false;
  const author = filters.author.trim().toLowerCase();
  if (author && !pullRequest.author.toLowerCase().includes(author)) return false;
  if (filters.review && pullRequest.reviewStatus !== filters.review) return false;
  return true;
}

export function filterPullRequests(
  pullRequests: readonly PullRequestSummary[],
  filters: PullRequestFilterValues,
): PullRequestSummary[] {
  return pullRequests.filter((pullRequest) => matchesPullRequestFilters(pullRequest, filters));
}

/**
 * Mirrors the current filter into the page address without adding a history entry
 * and without re-rendering the page, so typing in the author field keeps the
 * caret and a refresh still reads the same filter.
 */
export function writePullRequestFiltersToAddress(
  path: string,
  filters: PullRequestFilterValues,
): void {
  const hash = makeHash(path, repositoryPullRequestsSearch(toPullRequestFilterQuery(filters)));
  window.history.replaceState(null, "", hash);
}

/** The visible label of one status filter link. */
export function pullRequestStatusFilterLabel(status: PullRequestStatus): string {
  return pullRequestStatusLabel(status);
}
